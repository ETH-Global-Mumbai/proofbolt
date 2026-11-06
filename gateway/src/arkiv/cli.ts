// Wallet and grant admin for Arkiv. Run with: pnpm arkiv <command>
import { randomBytes } from "node:crypto";
import qrcode from "qrcode-terminal";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashCode } from "../grants.ts";
import { errorText } from "../log/errors.ts";
import { Arkiv } from "./backend.ts";

const USAGE = `Commands:
  wallet             Create a new wallet and print its key
  check              Read from Arkiv, then write a short-lived test grant and read it back
  grant [minutes]    Create a grant for LOCK_ID (default 1440 minutes)
  revoke <grant>     Revoke a grant`;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See .env.example`);
  return value;
}

function connect(): Arkiv {
  return new Arkiv(process.env.ARKIV_ACCESS_KEY ?? "", env("ARKIV_PRIVATE_KEY") as Hex);
}

const [command, argument] = process.argv.slice(2);

async function run(): Promise<void> {
  switch (command) {
  case "wallet": {
    const key = generatePrivateKey();
    console.log(`ARKIV_PRIVATE_KEY=${key}`);
    console.log(`Address: ${privateKeyToAccount(key).address}`);
    console.log("Put the key in .env and fund the address at https://hub.arkiv.network/faucet");
    break;
  }
  case "check": {
    const arkiv = connect();
    const lockerId = env("LOCK_ID");
    const balance = await arkiv.balance();
    console.log(`Wallet ${arkiv.address}, balance ${balance} tGLM`);
    if (Number(balance) === 0) throw new Error("This wallet has no tGLM. Send the faucet's tokens to the address above");
    console.log(`Read: ${(await arkiv.readStatus(lockerId)).attempts.length} recent attempts`);
    const key = await arkiv.createGrant(lockerId, 120, hashCode(randomBytes(16).toString("base64url")));
    console.log(`Write: test grant ${key}, expires in 2 minutes`);
    console.log(`Read back: ${JSON.stringify(await arkiv.getGrant(key))}`);
    break;
  }
  case "grant": {
    const minutes = Number(argument ?? 1440);
    if (!Number.isInteger(minutes) || minutes < 1) throw new Error("Minutes must be a whole number");
    // The code exists only in this link. Arkiv gets its hash, so nobody can recover it from there.
    const code = randomBytes(16).toString("base64url");
    const key = await connect().createGrant(env("LOCK_ID"), minutes * 60, hashCode(code));
    const base = process.env.KIOSK_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;
    console.log(`Grant ${key}, expires in ${minutes} minutes`);
    const link = `${base}/?grant=${key}#code=${code}`;
    console.log(`Access link, which works for anyone who has it: ${link}`);
    if (base.startsWith("https://")) qrcode.generate(link, { small: true });
    else console.log("Set KIOSK_URL to your https tunnel to get a QR code for phones.");
    break;
  }
  case "revoke": {
    if (!argument) throw new Error(USAGE);
    await connect().revokeGrant(argument);
    console.log(`Revoked ${argument}`);
    break;
  }
  default:
    console.log(USAGE);
}
}

try {
  await run();
} catch (error) {
  console.error(errorText(error));
  process.exitCode = 1;
}
