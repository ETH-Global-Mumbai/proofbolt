import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import type { AiDecision, Decider } from "./ai/types.ts";
import { ZeroGDecider } from "./ai/zerog.ts";
import { FakeDecider, FakeWorld } from "./dev.ts";
import { GrantStore } from "./grants.ts";
import { LockClient } from "./lock/client.ts";
import { parseKey } from "./lock/protocol.ts";
import { EpisodeLog } from "./log/episode.ts";
import { createApp } from "./server.ts";
import { LockerService } from "./service.ts";
import type { WorldProvider } from "./world/types.ts";
import { SANDBOX_ISSUER, WorldOidc } from "./world/oidc.ts";

const HEARTBEAT_MS = 3000;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See .env.example`);
  return value;
}

const devMocks = process.env.DEV_MOCKS === "1";
if (devMocks) console.warn("DEV_MOCKS=1: World ID and the AI are FAKE. Never use this for a real demo.");

mkdirSync("data", { recursive: true });
const grants = new GrantStore("data/grants.json");
if (devMocks && !grants.get("dev-grant")) {
  grants.put({
    id: "dev-grant",
    lockerId: "locker-1",
    expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
    revoked: false,
    subject: null,
    enrollable: true,
  });
}

const devAi = process.env.DEV_AI ?? "OPEN";
if (!["OPEN", "HOLD", "ALERT", "DOWN"].includes(devAi)) throw new Error("DEV_AI must be OPEN, HOLD, ALERT or DOWN");

const decider: Decider = devMocks
  ? new FakeDecider(devAi as AiDecision | "DOWN")
  : new ZeroGDecider({
      apiKey: required("OG_API_KEY"),
      baseUrl: process.env.OG_BASE,
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

const lock = new LockClient(required("LOCK_URL"), required("LOCK_ID"), parseKey(required("LOCK_KEY_HEX")));
const service = new LockerService({ grants, lock, decider, world, log: new EpisodeLog("data/episode.jsonl") });

// Silence from the gateway makes the board fall back to SAFE STOP by itself.
setInterval(async () => {
  const result = await lock.send("PING");
  if (!result.ok) console.warn(`[lock] heartbeat failed: ${result.error}`);
}, HEARTBEAT_MS);

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: createApp(service, { devMocks }).fetch, port });
console.log(`Gateway on http://localhost:${port}`);
