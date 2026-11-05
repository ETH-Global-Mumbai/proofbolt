// The public status page. It reads Arkiv and nothing else: it has no wallet and no link to the
// gateway, so it still tells the truth when the gateway is dead.
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Hex } from "viem";
import { ArkivRead } from "./arkiv/backend.ts";
import { errorText } from "./log/errors.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See .env.example`);
  return value;
}

const gateway = required("ARKIV_GATEWAY_ADDRESS") as Hex;
const lockerId = required("LOCK_ID");
const arkiv = new ArkivRead(process.env.ARKIV_ACCESS_KEY ?? "", gateway);
const page = readFileSync(new URL("../public/status.html", import.meta.url), "utf8");

const app = new Hono();
app.get("/", (c) => c.html(page));
app.get("/api/status", async (c) => {
  try {
    return c.json({ lockerId, gateway, ...(await arkiv.readStatus(lockerId)) });
  } catch (error) {
    console.warn(`[arkiv] read failed: ${errorText(error)}`);
    return c.json({ error: "Arkiv unreachable" }, 503);
  }
});

const port = Number(process.env.STATUS_PORT ?? 8090);
serve({ fetch: app.fetch, port });
console.log(`Status page on http://localhost:${port}`);
