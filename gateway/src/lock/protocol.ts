// The firmware's copy lives in firmware/include/lock_protocol.h and must stay byte-identical.
import { createHmac, timingSafeEqual } from "node:crypto";

export type LockCommand = "OPEN" | "SHOW" | "SAFE" | "PING";

export const NONCE_TTL_MS = 15_000;
export const MAX_ARG_LENGTH = 64;

export function commandMessage(lockId: string, nonce: string, cmd: string, arg: string): string {
  return `locker-v1\n${lockId}\n${nonce}\n${cmd}\n${arg}`;
}

export function ackMessage(lockId: string, nonce: string, cmd: string, result: string): string {
  return `locker-ack-v1\n${lockId}\n${nonce}\n${cmd}\n${result}`;
}

export function hmacHex(key: Buffer, message: string): string {
  return createHmac("sha256", key).update(message, "utf8").digest("hex");
}

export function macsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

// A newline would make two different commands sign the same message.
export function isValidArg(arg: string): boolean {
  return arg.length <= MAX_ARG_LENGTH && /^[\x20-\x7e]*$/.test(arg);
}

export function parseKey(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("Lock key must be 64 lowercase hex characters");
  return Buffer.from(hex, "hex");
}
