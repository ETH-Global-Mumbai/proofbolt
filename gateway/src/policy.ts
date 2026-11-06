// The only code that can authorize an unlock. The AI's answer is one input here and can't
// override the other checks, whatever a photo or prompt persuades the model to say.
import type { AiDecision } from "./ai/types.ts";
import type { Grant } from "./grants.ts";

export interface PolicyInput {
  now: number;
  /** The locker this gateway drives. A grant for any other locker opens nothing here. */
  lockerId: string;
  attemptExpiresAt: number;
  grant: Grant | null;
  /** True only if this attempt presented the grant's secret code. */
  codeVerified: boolean;
  aiDecision: AiDecision | null;
}

export type PolicyResult = { allow: true } | { allow: false; reason: string };

export function evaluate(input: PolicyInput): PolicyResult {
  const { now, lockerId, attemptExpiresAt, grant, codeVerified, aiDecision } = input;
  if (now >= attemptExpiresAt) return { allow: false, reason: "ATTEMPT_EXPIRED" };
  if (!grant) return { allow: false, reason: "NO_GRANT" };
  if (grant.lockerId !== lockerId) return { allow: false, reason: "WRONG_LOCKER" };
  if (grant.revoked) return { allow: false, reason: "GRANT_REVOKED" };
  if (now >= grant.expiresAt) return { allow: false, reason: "GRANT_EXPIRED" };
  if (!codeVerified) return { allow: false, reason: "CODE_NOT_VERIFIED" };
  if (aiDecision === null) return { allow: false, reason: "AI_UNAVAILABLE" };
  if (aiDecision !== "OPEN") return { allow: false, reason: `AI_${aiDecision}` };
  return { allow: true };
}
