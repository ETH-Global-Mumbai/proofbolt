// Stand-ins for running the whole flow with no credentials. main.ts enables them only with DEV_MOCKS=1.
import { randomBytes } from "node:crypto";
import type { AiDecision, AiResult, Decider } from "./ai/types.ts";
import { failedResult } from "./ai/types.ts";
import type { Subject } from "./grants.ts";
import type { PendingWorldCheck, WorldProvider } from "./world/types.ts";

export class FakeDecider implements Decider {
  constructor(public answer: AiDecision | "DOWN" = "OPEN") {}

  async decide(): Promise<AiResult> {
    if (this.answer === "DOWN") return failedResult("0G_UNREACHABLE", "Fake outage");
    return {
      status: "OK",
      decision: this.answer,
      requestId: `dev-${randomBytes(4).toString("hex")}`,
      provider: "dev",
      totalCost: "0",
      teeVerified: null,
      detail: null,
    };
  }
}

export class FakeWorld implements WorldProvider {
  constructor(public subject: Subject = { iss: "dev", sub: "dev-user" }) {}

  async start(): Promise<{ url: string; pending: PendingWorldCheck }> {
    const state = randomBytes(16).toString("hex");
    return {
      url: `/dev/world?state=${state}`,
      pending: { state, nonce: "dev", codeVerifier: "dev", startedAtSeconds: Math.floor(Date.now() / 1000) },
    };
  }

  async finish(): Promise<Subject> {
    return this.subject;
  }
}
