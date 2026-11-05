import { ackMessage, commandMessage, hmacHex, isValidArg, macsEqual, type LockCommand } from "./protocol.ts";

export interface LockSender {
  send(cmd: LockCommand, arg?: string): Promise<LockSendResult>;
}

export type LockSendResult = { ok: true } | { ok: false; error: string };

export class LockClient implements LockSender {
  // The lock holds one nonce at a time, so overlapping commands would invalidate each other.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly baseUrl: string,
    private readonly lockId: string,
    private readonly key: Buffer,
    private readonly timeoutMs = 3000,
  ) {}

  send(cmd: LockCommand, arg = ""): Promise<LockSendResult> {
    const run = this.queue.then(() => this.sendNow(cmd, arg));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async sendNow(cmd: LockCommand, arg: string): Promise<LockSendResult> {
    if (!isValidArg(arg)) return { ok: false, error: "BAD_ARG" };
    try {
      const nonceResponse = await fetch(`${this.baseUrl}/nonce`, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!nonceResponse.ok) return { ok: false, error: `NONCE_HTTP_${nonceResponse.status}` };
      const { nonce } = (await nonceResponse.json()) as { nonce: string };

      const mac = hmacHex(this.key, commandMessage(this.lockId, nonce, cmd, arg));
      const response = await fetch(`${this.baseUrl}/cmd`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ nonce, cmd, arg, mac }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = (await response.json()) as { result?: string; ack?: string; error?: string };
      if (!response.ok || body.result !== "OK" || !body.ack) {
        return { ok: false, error: body.error ?? `CMD_HTTP_${response.status}` };
      }

      const expectedAck = hmacHex(this.key, ackMessage(this.lockId, nonce, cmd, "OK"));
      if (!macsEqual(body.ack, expectedAck)) return { ok: false, error: "BAD_ACK" };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `LOCK_UNREACHABLE: ${(error as Error).name}` };
    }
  }
}
