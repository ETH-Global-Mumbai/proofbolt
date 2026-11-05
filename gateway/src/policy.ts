// The only code that can authorize an unlock. The AI's answer is one input here and can't
// override the other checks, whatever a photo or prompt persuades the model to say.
import type { AiDecision } from "./ai/types.ts";
import type { Grant, Subject } from "./grants.ts";

export interface PolicyInput {
  now: number;
  attemptExpiresAt: number;
  grant: Grant | null;
  /** Null unless the World ID callback validated for this attempt. */
  worldSubject: Subject | null;
  aiDecision: AiDecision | null;
}

export type PolicyResult = { allow: true } | { allow: false; reason: string };

export function evaluate(input: PolicyInput): PolicyResult {
  const { now, attemptExpiresAt, grant, worldSubject, aiDecision } = input;
  if (now >= attemptExpiresAt) return { allow: false, reason: "ATTEMPT_EXPIRED" };
  if (!grant) return { allow: false, reason: "NO_GRANT" };
  if (grant.revoked) return { allow: false, reason: "GRANT_REVOKED" };
  if (now >= grant.expiresAt) return { allow: false, reason: "GRANT_EXPIRED" };
  if (!worldSubject) return { allow: false, reason: "WORLD_NOT_VERIFIED" };
  if (!grant.subject) return { allow: false, reason: "GRANT_NOT_ENROLLED" };
  if (grant.subject.iss !== worldSubject.iss || grant.subject.sub !== worldSubject.sub) {
    return { allow: false, reason: "WRONG_PERSON" };
  }
  if (aiDecision === null) return { allow: false, reason: "AI_UNAVAILABLE" };
  if (aiDecision !== "OPEN") return { allow: false, reason: `AI_${aiDecision}` };
  return { allow: true };
}
