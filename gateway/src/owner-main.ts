// Starts the owner's page, reachable only from this machine. Keep it off any tunnel: it can create
// and revoke access with the gateway's wallet, and it has no login.
import { serve } from "@hono/node-server";
import type { Hex } from "viem";
import { Arkiv } from "./arkiv/backend.ts";
import { createOwnerApp } from "./owner.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See .env.example`);
  return value;
}

const port = Number(process.env.OWNER_PORT ?? 8070);
const arkiv = new Arkiv(process.env.ARKIV_ACCESS_KEY ?? "", required("ARKIV_PRIVATE_KEY") as Hex);
const app = createOwnerApp(arkiv, {
  lockerId: required("LOCK_ID"),
  port,
  gateway: arkiv.address,
  kioskUrl: process.env.KIOSK_URL || `http://localhost:${process.env.PORT ?? 8080}`,
  statusUrl: `http://localhost:${process.env.STATUS_PORT ?? 8090}`,
});

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`Owner page on http://localhost:${port}`);
