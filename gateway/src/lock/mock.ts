// Software stand-in for the firmware, with the same HTTP API and nonce rules.
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ackMessage, commandMessage, hmacHex, isValidArg, macsEqual, NONCE_TTL_MS } from "./protocol.ts";

const KNOWN_COMMANDS = new Set(["OPEN", "SHOW", "SAFE", "PING"]);

export class MockLock {
  openCount = 0;
  display = "LOCKED";
  /** The last command form seen, so tests can replay it the way an attacker would. */
  lastCommandForm: URLSearchParams | null = null;
  private nonce: string | null = null;
  private nonceAt = 0;
  private server: Server | null = null;

  constructor(
    private readonly lockId: string,
    private readonly key: Buffer,
  ) {}

  async listen(port = 0): Promise<string> {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { code, payload } = this.handle(req.method ?? "", req.url ?? "", body);
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(port, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    await new Promise((resolve) => this.server?.close(resolve));
  }

  private handle(method: string, url: string, body: string): { code: number; payload: object } {
    if (method === "GET" && url === "/nonce") {
      this.nonce = randomBytes(16).toString("hex");
      this.nonceAt = Date.now();
      return { code: 200, payload: { nonce: this.nonce, ttlMs: NONCE_TTL_MS } };
    }
    if (method === "GET" && url === "/status") {
      return { code: 200, payload: { lockId: this.lockId, openCount: this.openCount, display: this.display } };
    }
    if (method === "POST" && url === "/cmd") return this.handleCommand(new URLSearchParams(body));
    return { code: 404, payload: { error: "NOT_FOUND" } };
  }

  private handleCommand(form: URLSearchParams): { code: number; payload: object } {
    const cmd = form.get("cmd") ?? "";
    const arg = form.get("arg") ?? "";
    const given = form.get("nonce") ?? "";
    this.lastCommandForm = form;

    const nonce = this.nonce;
    this.nonce = null;
    if (!nonce) return { code: 403, payload: { error: "NO_NONCE" } };
    if (Date.now() - this.nonceAt > NONCE_TTL_MS) return { code: 403, payload: { error: "EXPIRED" } };
    if (given !== nonce) return { code: 403, payload: { error: "BAD_NONCE" } };
    if (!KNOWN_COMMANDS.has(cmd)) return { code: 403, payload: { error: "BAD_CMD" } };
    if (!isValidArg(arg)) return { code: 403, payload: { error: "BAD_ARG" } };

    const expected = hmacHex(this.key, commandMessage(this.lockId, nonce, cmd, arg));
    if (!macsEqual(form.get("mac") ?? "", expected)) return { code: 403, payload: { error: "BAD_MAC" } };

    if (cmd === "OPEN") {
      this.openCount++;
      this.display = "OPEN";
    } else if (cmd === "SAFE") {
      this.display = `SAFE STOP ${arg}`;
    } else if (cmd === "SHOW") {
      this.display = arg;
    }
    return {
      code: 200,
      payload: { result: "OK", ack: hmacHex(this.key, ackMessage(this.lockId, nonce, cmd, "OK")) },
    };
  }
}
