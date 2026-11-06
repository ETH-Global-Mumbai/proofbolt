// One unlock attempt, from request to door. Every failure takes the same failClosed path.
import { createHash, randomInt, randomUUID } from "node:crypto";
import type { AiResult, Decider } from "./ai/types.ts";
import { codeMatches, type Grant, type GrantBook } from "./grants.ts";
import type { LockSender } from "./lock/client.ts";
import { errorText } from "./log/errors.ts";
import type { EpisodeLog } from "./log/episode.ts";
import { evaluate } from "./policy.ts";

export const ATTEMPT_TTL_MS = 180_000;
/** Photos per attempt. Only a HOLD earns another try, and every try is logged. */
export const MAX_PHOTO_TRIES = 3;
const GRANTS_DOWN = "ARKIV_UNREACHABLE";

export type AttemptState = "CHECKING_ACCESS" | "AWAITING_PHOTO" | "DECIDING" | "OPENED" | "DENIED";

export interface Attempt {
  id: string;
  grantId: string;
  lockerId: string;
  state: AttemptState;
  expiresAt: number;
  challenge: string | null;
  reason: string | null;
  codeVerified: boolean;
  requestId: string | null;
  triesLeft: number;
  /** True after a HOLD, when the person is being asked to try again. */
  retrying: boolean;
}

export type PublicAttempt = Pick<
  Attempt,
  "id" | "state" | "challenge" | "reason" | "expiresAt" | "requestId" | "triesLeft" | "retrying"
>;

const CHALLENGES = [
  "SHOW 1 FINGER",
  "SHOW 2 FINGERS",
  "SHOW 3 FINGERS",
  "SHOW 4 FINGERS",
  "SHOW OPEN PALM",
  "SHOW A FIST",
  "SHOW THUMBS UP",
];

/** Told how each attempt ended. Reports go public, so they never carry the access code. */
export interface AttemptReporter {
  attempt(report: { lockerId: string; attemptId: string; outcome: string; reason: string; requestId: string; at: number }): void;
}

export interface ServiceDeps {
  lockerId: string;
  grants: GrantBook;
  reporter?: AttemptReporter;
  lock: LockSender;
  decider: Decider;
  log: EpisodeLog;
  now?: () => number;
}

export class LockerService {
  private attempts = new Map<string, Attempt>();
  private readonly now: () => number;

  constructor(private readonly deps: ServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  view({ id, state, challenge, reason, expiresAt, requestId, triesLeft, retrying }: Attempt): PublicAttempt {
    return { id, state, challenge, reason, expiresAt, requestId, triesLeft, retrying };
  }

  get(id: string): Attempt | null {
    return this.attempts.get(id) ?? null;
  }

  /** Checks the grant and its secret code, then asks for the gesture. */
  async create(grantId: string, code: string): Promise<Attempt> {
    const attempt: Attempt = {
      id: randomUUID(),
      grantId,
      lockerId: this.deps.lockerId,
      state: "CHECKING_ACCESS",
      expiresAt: this.now() + ATTEMPT_TTL_MS,
      challenge: null,
      reason: null,
      codeVerified: false,
      requestId: null,
      triesLeft: MAX_PHOTO_TRIES,
      retrying: false,
    };
    this.attempts.set(attempt.id, attempt);

    let grant: Grant | null;
    try {
      grant = await this.deps.grants.get(grantId);
    } catch (error) {
      console.warn(`[grants] unavailable: ${errorText(error)}`);
      return this.failClosed(attempt, GRANTS_DOWN);
    }
    // Anyone can send these two, so they cost nothing: no Arkiv write and nothing on the display.
    if (!grant) return this.refuse(attempt, "NO_GRANT");
    if (!codeMatches(grant, code)) return this.refuse(attempt, "BAD_CODE");

    attempt.codeVerified = true;
    if (grant.lockerId !== attempt.lockerId) return this.failClosed(attempt, "WRONG_LOCKER");
    if (grant.revoked) return this.failClosed(attempt, "GRANT_REVOKED");
    // Finding a dead lock now saves the person a gesture and an AI call.
    if (!(await this.askForPhoto(attempt))) return this.failClosed(attempt, "LOCK_UNREACHABLE");
    return attempt;
  }

  async submitPhoto(id: string, imageDataUrl: string): Promise<Attempt> {
    const attempt = this.require(id);
    if (attempt.state !== "AWAITING_PHOTO") throw new Error(`Cannot accept a photo in ${attempt.state}`);
    // Set before the first await, so a second request can't run this attempt twice.
    attempt.state = "DECIDING";

    const challenge = attempt.challenge!;
    const ai = await this.deps.decider.decide({ challenge, imageDataUrl });
    attempt.requestId = ai.requestId;
    if (ai.status !== "OK") console.warn(`[ai] ${ai.status}: ${ai.detail}`);

    // Read after the AI call, so a grant revoked during that call still counts.
    let grant: Grant | null;
    try {
      grant = await this.deps.grants.get(attempt.grantId);
    } catch (error) {
      console.warn(`[grants] unavailable: ${errorText(error)}`);
      this.record(attempt, imageDataUrl, ai, GRANTS_DOWN, "NOT_SENT");
      return this.failClosed(attempt, GRANTS_DOWN);
    }

    const policy = evaluate({
      now: this.now(),
      lockerId: attempt.lockerId,
      attemptExpiresAt: attempt.expiresAt,
      grant,
      codeVerified: attempt.codeVerified,
      aiDecision: ai.decision,
    });

    let lockAck = "NOT_SENT";
    if (policy.allow) {
      const sent = await this.deps.lock.send("OPEN");
      lockAck = sent.ok ? "OK" : sent.error;
      if (sent.ok) attempt.state = "OPENED";
    }
    this.record(attempt, imageDataUrl, ai, policy.allow ? "ALLOW" : policy.reason, lockAck);
    if (attempt.state === "OPENED") {
      attempt.retrying = false;
      this.report(attempt);
      return attempt;
    }

    if (policy.allow) return this.failClosed(attempt, "LOCK_UNREACHABLE");
    if (!policy.allow && policy.reason === "AI_HOLD" && attempt.triesLeft > 1) {
      attempt.triesLeft--;
      attempt.retrying = true;
      if (!(await this.askForPhoto(attempt))) return this.failClosed(attempt, "LOCK_UNREACHABLE");
      return attempt;
    }
    return this.failClosed(attempt, ai.status === "OK" ? policy.reason : ai.status);
  }

  /** Always a new challenge, so a retry can't reuse the last photo's gesture. */
  private async askForPhoto(attempt: Attempt): Promise<boolean> {
    const others = CHALLENGES.filter((challenge) => challenge !== attempt.challenge);
    attempt.challenge = others[randomInt(others.length)]!;
    attempt.state = "AWAITING_PHOTO";
    return (await this.deps.lock.send("SHOW", `Do this:|${attempt.challenge}`)).ok;
  }

  private record(attempt: Attempt, imageDataUrl: string, ai: AiResult, policy: string, lockAck: string): void {
    this.deps.log.append({
      attemptId: attempt.id,
      lockerId: attempt.lockerId,
      at: new Date(this.now()).toISOString(),
      challenge: attempt.challenge ?? "",
      imageSha256: createHash("sha256").update(imageDataUrl).digest("hex"),
      aiStatus: ai.status,
      decision: ai.decision,
      requestId: ai.requestId,
      provider: ai.provider,
      totalCost: ai.totalCost,
      teeVerified: ai.teeVerified,
      policy,
      lockAck,
    });
  }

  private report(attempt: Attempt): void {
    this.deps.reporter?.attempt({
      lockerId: attempt.lockerId,
      attemptId: attempt.id,
      outcome: attempt.state,
      reason: attempt.reason ?? "",
      requestId: attempt.requestId ?? "",
      at: this.now(),
    });
  }

  private refuse(attempt: Attempt, reason: string): Attempt {
    attempt.state = "DENIED";
    attempt.reason = reason;
    return attempt;
  }

  private async failClosed(attempt: Attempt, reason: string): Promise<Attempt> {
    attempt.state = "DENIED";
    attempt.reason = reason;
    attempt.retrying = false;
    attempt.codeVerified = false;
    this.report(attempt);
    const line = reason === "0G_UNREACHABLE" ? "0G unreachable" : reason;
    await this.deps.lock.send(reason === "0G_UNREACHABLE" ? "SAFE" : "SHOW", reason === "0G_UNREACHABLE" ? line : `DENIED|${line}`);
    return attempt;
  }

  private require(id: string): Attempt {
    const attempt = this.attempts.get(id);
    if (!attempt) throw new Error("Unknown attempt");
    return attempt;
  }
}
