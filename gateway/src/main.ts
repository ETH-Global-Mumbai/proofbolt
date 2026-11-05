import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import type { Hex } from "viem";
import type { AiDecision, Decider } from "./ai/types.ts";
import { Arkiv } from "./arkiv/backend.ts";
import { BOARD_BEAT_MS, LockerBoard } from "./arkiv/board.ts";
import { ArkivGrants } from "./arkiv/grants.ts";
import { ZeroGDecider } from "./ai/zerog.ts";
import { FakeDecider, FakeWorld } from "./dev.ts";
import { GrantStore, type GrantBook } from "./grants.ts";
import { LockClient } from "./lock/client.ts";
import { parseKey } from "./lock/protocol.ts";
import { EpisodeLog } from "./log/episode.ts";
import { EpisodePublisher } from "./zerog/publisher.ts";
import { ZeroGNetwork } from "./zerog/network.ts";
import { createApp } from "./server.ts";
import { LockerService } from "./service.ts";
import type { WorldProvider } from "./world/types.ts";
import { SANDBOX_ISSUER, WorldOidc } from "./world/oidc.ts";

const HEARTBEAT_MS = 3000;
const PUBLISH_MS = 15_000;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See .env.example`);
  return value;
}

const devMocks = process.env.DEV_MOCKS === "1";
const devAi = process.env.DEV_AI ?? "OPEN";
if (!["OPEN", "HOLD", "ALERT", "DOWN", "LIVE"].includes(devAi)) throw new Error("DEV_AI must be OPEN, HOLD, ALERT, DOWN or LIVE");
const fakeAi = devMocks && devAi !== "LIVE";
if (devMocks) {
  console.warn(`DEV_MOCKS=1: World ID${fakeAi ? " and the AI are" : " is"} FAKE. Never use this for a real demo.`);
}

mkdirSync("data", { recursive: true });
const lockerId = required("LOCK_ID");

// Only DEV_MOCKS may run without Arkiv. A real demo refuses to start with local grants.
const arkiv = process.env.ARKIV_PRIVATE_KEY || !devMocks
  ? new Arkiv(process.env.ARKIV_ACCESS_KEY ?? "", required("ARKIV_PRIVATE_KEY") as Hex)
  : null;
const board = arkiv ? new LockerBoard(arkiv, lockerId) : undefined;

async function openGrants(): Promise<GrantBook> {
  if (arkiv) {
    console.log(`[arkiv] gateway wallet ${arkiv.address}`);
    return new ArkivGrants(arkiv, "data/enrollments.json");
  }
  const local = new GrantStore("data/grants.json");
  if (!(await local.get("dev-grant"))) {
    local.put({
      id: "dev-grant",
      lockerId,
      expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
      revoked: false,
      subject: null,
      enrollable: true,
    });
  }
  return local;
}

const grants = await openGrants();

const decider: Decider = fakeAi
  ? new FakeDecider(devAi as AiDecision | "DOWN")
  : new ZeroGDecider({
      apiKey: required("OG_API_KEY"),
      baseUrl: process.env.OG_BASE || undefined,
      model: process.env.OG_MODEL,
      verifyTee: process.env.OG_VERIFY_TEE === "1",
    });

const world: WorldProvider = devMocks
  ? new FakeWorld({ iss: "dev", sub: process.env.DEV_WORLD_SUB ?? "dev-user" })
  : new WorldOidc({
      issuer: process.env.WORLD_ISSUER ?? SANDBOX_ISSUER,
      clientId: required("WORLD_CLIENT_ID"),
      clientSecret: required("WORLD_CLIENT_SECRET"),
      redirectUri: required("WORLD_REDIRECT_URI"),
    });

const lock = new LockClient(required("LOCK_URL"), lockerId, parseKey(required("LOCK_KEY_HEX")));
const log = new EpisodeLog("data/episode.jsonl");

// Only DEV_MOCKS may run without 0G's record of decisions.
if (process.env.OG_PRIVATE_KEY || !devMocks) {
  const zerog = new ZeroGNetwork({
    rpcUrl: process.env.OG_CHAIN_RPC,
    chainId: Number(process.env.OG_CHAIN_ID) || undefined,
    privateKey: required("OG_PRIVATE_KEY"),
    anchorAddress: required("OG_ANCHOR_ADDRESS"),
  });
  const publisher = new EpisodePublisher(log, zerog, zerog, board ?? null, "data/published.json");
  console.log(`[0g] gateway wallet ${zerog.signer.address}`);
  setInterval(() => void publisher.sync(), PUBLISH_MS);
}

const service = new LockerService({
  lockerId,
  grants,
  lock,
  decider,
  world,
  reporter: board,
  log,
});

// Silence from the gateway makes the board fall back to SAFE STOP by itself.
let lockReachable = true;
setInterval(async () => {
  const result = await lock.send("PING");
  lockReachable = result.ok;
  if (!result.ok) console.warn(`[lock] heartbeat failed: ${result.error}`);
}, HEARTBEAT_MS);

if (board) {
  void board.beat(lockReachable);
  setInterval(() => void board.beat(lockReachable), BOARD_BEAT_MS);
}

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: createApp(service, { devMocks }).fetch, port });
console.log(`Gateway on http://localhost:${port}`);
