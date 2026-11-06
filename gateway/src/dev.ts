// A stand-in for running the whole flow with no credentials. main.ts enables it only with DEV_MOCKS=1.
import { randomBytes } from "node:crypto";
import type { AiDecision, AiResult, Decider } from "./ai/types.ts";
import { failedResult } from "./ai/types.ts";

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
