// One unlock attempt, from request to door. Every failure takes the same failClosed path.
import { createHash, randomInt, randomUUID } from "node:crypto";
import type { AiResult, Decider } from "./ai/types.ts";
import type { Grant, GrantBook, Subject } from "./grants.ts";
import type { LockSender } from "./lock/client.ts";
import { errorText } from "./log/errors.ts";
import type { EpisodeLog } from "./log/episode.ts";
import { evaluate } from "./policy.ts";
import type { PendingWorldCheck, WorldProvider } from "./world/types.ts";

export const ATTEMPT_TTL_MS = 180_000;
const GRANTS_DOWN = "ARKIV_UNREACHABLE";

export type AttemptState = "AWAITING_WORLD" | "WORLD_PENDING" | "AWAITING_PHOTO" | "DECIDING" | "OPENED" | "DENIED";

export interface Attempt {
  id: string;
  grantId: string;
  lockerId: string;
  state: AttemptState;
  expiresAt: number;
  challenge: string | null;
  reason: string | null;
  worldSubject: Subject | null;
  pendingWorld: PendingWorldCheck | null;
  requestId: string | null;
}

export type PublicAttempt = Pick<Attempt, "id" | "state" | "challenge" | "reason" | "expiresAt">;

const CHALLENGES = [
  "SHOW 1 FINGER",
  "SHOW 2 FINGERS",
  "SHOW 3 FINGERS",
  "SHOW 4 FINGERS",
  "SHOW OPEN PALM",
  "SHOW A FIST",
  "SHOW THUMBS UP",
];

/** Told how each attempt ended. Reports go public, so they never carry a World ID. */
export interface AttemptReporter {
  attempt(report: { lockerId: string; attemptId: string; outcome: string; reason: string; requestId: string; at: number }): void;
}

export interface ServiceDeps {
  lockerId: string;
  grants: GrantBook;
  reporter?: AttemptReporter;
  lock: LockSender;
  decider: Decider;
  world: WorldProvider;
  log: EpisodeLog;
  now?: () => number;
}

export class LockerService {
  private attempts = new Map<string, Attempt>();
  private readonly now: () => number;

  constructor(private readonly deps: ServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  view({ id, state, challenge, reason, expiresAt }: Attempt): PublicAttempt {
    return { id, state, challenge, reason, expiresAt };
  }

  get(id: string): Attempt | null {
    return this.attempts.get(id) ?? null;
  }

  create(grantId: string): Attempt {
    const attempt: Attempt = {
      id: randomUUID(),
      grantId,
      lockerId: this.deps.lockerId,
      state: "AWAITING_WORLD",
      expiresAt: this.now() + ATTEMPT_TTL_MS,
      challenge: null,
      reason: null,
      worldSubject: null,
      pendingWorld: null,
      requestId: null,
    };
    this.attempts.set(attempt.id, attempt);
    return attempt;
  }

  async startWorld(id: string): Promise<string> {
    const attempt = this.require(id);
    if (attempt.state !== "AWAITING_WORLD") throw new Error(`Cannot start World from ${attempt.state}`);
    const { url, pending } = await this.deps.world.start();
    attempt.pendingWorld = pending;
    attempt.state = "WORLD_PENDING";
    return url;
  }

  /** Handles the World redirect. Returns the attempt, or null if the state is unknown. */
  async finishWorld(params: { state: string; code?: string; error?: string }): Promise<Attempt | null> {
    const attempt = [...this.attempts.values()].find((a) => a.pendingWorld?.state === params.state);
    if (!attempt || attempt.state !== "WORLD_PENDING") return null;
    const pending = attempt.pendingWorld!;
    // State and code are single use, so a repeated callback finds nothing.
    attempt.pendingWorld = null;

    if (params.error || !params.code) {
      return this.failClosed(attempt, params.error === "access_denied" ? "WORLD_DENIED" : "WORLD_FAILED");
    }

    let subject: Subject;
    try {
      subject = await this.deps.world.finish(params.code, pending);
    } catch (error) {
      console.warn(`[world] rejected: ${(error as Error).message}`);
      return this.failClosed(attempt, "WORLD_INVALID");
    }

    if (this.now() >= attempt.expiresAt) return this.failClosed(attempt, "ATTEMPT_EXPIRED");

    let enrolled: Subject;
    try {
      const grant = await this.deps.grants.get(attempt.grantId);
      if (!grant) return this.failClosed(attempt, "NO_GRANT");
      if (grant.lockerId !== attempt.lockerId) return this.failClosed(attempt, "WRONG_LOCKER");
      if (grant.revoked) return this.failClosed(attempt, "GRANT_REVOKED");
      if (!grant.subject && !(await this.deps.grants.enroll(grant.id, subject))) {
        return this.failClosed(attempt, "ENROLLMENT_REFUSED");
      }
      enrolled = grant.subject ?? subject;
    } catch (error) {
      console.warn(`[grants] unavailable: ${errorText(error)}`);
      return this.failClosed(attempt, GRANTS_DOWN);
    }
    if (enrolled.iss !== subject.iss || enrolled.sub !== subject.sub) {
      return this.failClosed(attempt, "WRONG_PERSON");
    }

    attempt.worldSubject = subject;
    attempt.challenge = CHALLENGES[randomInt(CHALLENGES.length)]!;
    attempt.state = "AWAITING_PHOTO";
    await this.deps.lock.send("SHOW", `Do this:|${attempt.challenge}`);
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
      worldSubject: attempt.worldSubject,
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
      this.report(attempt);
      return attempt;
    }

    if (policy.allow) return this.failClosed(attempt, "LOCK_UNREACHABLE");
    return this.failClosed(attempt, ai.status === "OK" ? policy.reason : ai.status);
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

  private async failClosed(attempt: Attempt, reason: string): Promise<Attempt> {
    attempt.state = "DENIED";
    attempt.reason = reason;
    attempt.worldSubject = null;
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
