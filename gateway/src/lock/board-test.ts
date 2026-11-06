// Walks a real board through its display messages and an open cycle, so you can watch the parts.
// Run with: LOCK_URL=http://<board ip> pnpm lock-test
import { LockClient } from "./client.ts";
import { parseKey } from "./protocol.ts";

const STEP_MS = 6000;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See .env.example`);
  return value;
}

const url = required("LOCK_URL");
const lock = new LockClient(url, required("LOCK_ID"), parseKey(required("LOCK_KEY_HEX")));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function status(): Promise<string> {
  const response = await fetch(`${url}/status`, { signal: AbortSignal.timeout(3000) });
  const { locked, uptimeMs } = (await response.json()) as { locked: boolean; uptimeMs: number };
  return `${locked ? "locked" : "open"}, up ${Math.round(uptimeMs / 1000)} s`;
}

async function step(expect: string, cmd: "SHOW" | "OPEN" | "SAFE", arg = ""): Promise<void> {
  console.log(`Watch for: ${expect}`);
  const result = await lock.send(cmd, arg);
  if (!result.ok) throw new Error(`The board refused ${cmd}: ${result.error}`);
  await wait(STEP_MS);
}

try {
  console.log(`Board at ${url}: ${await status()}`);
  await step("PROOFBOLT / Display test", "SHOW", "PROOFBOLT|Display test");
  await step("Do this: / SHOW 2 FINGERS", "SHOW", "Do this:|SHOW 2 FINGERS");
  await step("DENIED / AI_HOLD", "SHOW", "DENIED|AI_HOLD");
  await step("OPEN / Relocks shortly, servo turns, green LED on. It relocks after 5 s", "OPEN");
  console.log(`Now: ${await status()}`);
  await step("SAFE STOP / 0G unreachable, red LED on", "SAFE", "0G unreachable");
  console.log(`Finished: ${await status()}. In about 8 s the board shows SAFE STOP / Gateway lost.`);
} catch (error) {
  const unreachable = error instanceof TypeError || (error as Error).name === "TimeoutError";
  console.error(unreachable ? `Can't reach ${url}. Is the hotspot on, and is the board's IP right?` : (error as Error).message);
  process.exitCode = 1;
}
