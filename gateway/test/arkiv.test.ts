// Runs the Arkiv logic and the whole unlock flow against an in-memory Arkiv.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  isTrusted,
  type ArkivBackend,
  type AttemptEntity,
  type DecisionEntity,
  type GrantEntity,
  type LockerStatus,
} from "../src/arkiv/backend.ts";
import { LockerBoard } from "../src/arkiv/board.ts";
import { ArkivGrants } from "../src/arkiv/grants.ts";
import { FakeDecider } from "../src/dev.ts";
import { hashCode } from "../src/grants.ts";
import { LockClient } from "../src/lock/client.ts";
import { MockLock } from "../src/lock/mock.ts";
import { EpisodeLog } from "../src/log/episode.ts";
import { errorText } from "../src/log/errors.ts";
import { LockerService } from "../src/service.ts";

const KEY = Buffer.alloc(32, 7);
const PHOTO = "data:image/jpeg;base64,AAAA";
const CODE = "secret-code";

class MemoryArkiv implements ArkivBackend {
  grants = new Map<string, GrantEntity>();
  locker: { key: string; lockReachable: boolean } | null = null;
  attempts: AttemptEntity[] = [];
  decisions: DecisionEntity[] = [];
  extensions = 0;
  patches = 0;
  down = false;

  private check(): void {
    if (this.down) throw new Error("Arkiv down");
  }

  async getGrant(key: string) {
    this.check();
    return this.grants.get(key) ?? null;
  }
  async listGrants() {
    this.check();
    return [...this.grants].map(([id, grant]) => ({ id, label: "", revoked: grant.revoked, expiresInSeconds: 60 }));
  }
  async findLocker() {
    this.check();
    return this.locker?.key ?? null;
  }
  async readStatus(): Promise<LockerStatus> {
    this.check();
    return { locker: this.locker, attempts: this.attempts, decisions: this.decisions };
  }
  async createGrant(lockerId: string, _expiresInSeconds = 3600, codeHash = hashCode(CODE)) {
    this.check();
    const key = `g${this.grants.size + 1}`;
    this.grants.set(key, { lockerId, revoked: false, codeHash });
    return key;
  }
  async revokeGrant(key: string) {
    this.check();
    this.grants.get(key)!.revoked = true;
  }
  async createLocker(_lockerId: string, lockReachable: boolean) {
    this.check();
    this.locker = { key: "locker", lockReachable };
    return this.locker.key;
  }
  async patchLocker(_key: string, lockReachable: boolean) {
    this.check();
    if (!this.locker) throw new Error("Expired");
    this.patches++;
    this.locker.lockReachable = lockReachable;
  }
  async extendLocker() {
    this.check();
    if (!this.locker) throw new Error("Expired");
    this.extensions++;
  }
  async createAttempt(attempt: AttemptEntity) {
    this.check();
    this.attempts.push(attempt);
  }
  async createDecision(decision: DecisionEntity) {
    this.check();
    this.decisions.push(decision);
  }
}

async function setup(t: TestContext, decider = new FakeDecider()) {
  const lock = new MockLock("locker-1", KEY);
  const url = await lock.listen();
  t.after(() => lock.close());

  const arkiv = new MemoryArkiv();
  const grants = new ArkivGrants(arkiv);
  const log = new EpisodeLog();
  const service = new LockerService({
    lockerId: "locker-1",
    grants,
    decider,
    log,
    reporter: new LockerBoard(arkiv, "locker-1"),
    lock: new LockClient(url, "locker-1", KEY),
  });

  const verified = (grantId: string, code = CODE) => service.create(grantId, code);
  return { lock, arkiv, grants, log, service, verified };
}

test("a grant on Arkiv opens the door and the result is published", async (t) => {
  const { arkiv, service, verified, lock } = await setup(t);
  const key = await arkiv.createGrant("locker-1");
  const attempt = await verified(key);
  await service.submitPhoto(attempt.id, PHOTO);

  assert.equal(attempt.state, "OPENED");
  assert.equal(lock.openCount, 1);
  assert.equal(arkiv.attempts[0]!.outcome, "OPENED");
  assert.ok(arkiv.attempts[0]!.requestId);
});

test("nothing published to Arkiv carries the access code", async (t) => {
  const { arkiv, service, verified } = await setup(t);
  const attempt = await verified(await arkiv.createGrant("locker-1"));
  await service.submitPhoto(attempt.id, PHOTO);
  const published = JSON.stringify([...arkiv.grants.values(), ...arkiv.attempts]);
  assert.ok(!published.includes(CODE));
});

test("a wrong code or unknown grant writes nothing, so it can't drain the wallet", async (t) => {
  const { arkiv, verified } = await setup(t);
  const key = await arkiv.createGrant("locker-1");
  assert.equal((await verified(key, "wrong")).reason, "BAD_CODE");
  assert.equal((await verified("nope")).reason, "NO_GRANT");
  assert.equal(arkiv.attempts.length, 0);
});

test("a grant that expired on Arkiv opens nothing", async (t) => {
  const { arkiv, verified, service, lock } = await setup(t);
  const key = await arkiv.createGrant("locker-1");
  const attempt = await verified(key);
  arkiv.grants.delete(key);
  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.reason, "NO_GRANT");
  assert.equal(lock.openCount, 0);
  assert.equal(arkiv.attempts[0]!.reason, "NO_GRANT");
});

test("revoking on Arkiv stops an attempt that is already past the code check", async (t) => {
  const { arkiv, verified, service, lock } = await setup(t);
  const key = await arkiv.createGrant("locker-1");
  const attempt = await verified(key);
  await arkiv.revokeGrant(key);
  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.reason, "GRANT_REVOKED");
  assert.equal(lock.openCount, 0);
});

test("a revoked grant is refused at the start", async (t) => {
  const { arkiv, verified } = await setup(t);
  const key = await arkiv.createGrant("locker-1");
  await arkiv.revokeGrant(key);
  assert.equal((await verified(key)).reason, "GRANT_REVOKED");
});

test("a grant for another locker is refused", async (t) => {
  const { arkiv, verified, lock } = await setup(t);
  const attempt = await verified(await arkiv.createGrant("locker-2"));
  assert.equal(attempt.reason, "WRONG_LOCKER");
  assert.equal(lock.openCount, 0);
});

test("Arkiv down at the start: door stays shut", async (t) => {
  const { arkiv, verified, lock } = await setup(t);
  const key = await arkiv.createGrant("locker-1");
  arkiv.down = true;
  const attempt = await verified(key);
  assert.equal(attempt.reason, "ARKIV_UNREACHABLE");
  assert.equal(lock.openCount, 0);
});

test("Arkiv down at the photo step: door stays shut and the decision is logged", async (t) => {
  const { arkiv, verified, service, lock, log } = await setup(t);
  const attempt = await verified(await arkiv.createGrant("locker-1"));
  arkiv.down = true;
  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.reason, "ARKIV_UNREACHABLE");
  assert.equal(lock.openCount, 0);
  assert.equal(log.records[0]!.policy, "ARKIV_UNREACHABLE");
  assert.equal(log.records[0]!.lockAck, "NOT_SENT");
});

test("a failed status write doesn't stop an allowed door", async (t) => {
  const { arkiv, verified, service, lock } = await setup(t);
  const attempt = await verified(await arkiv.createGrant("locker-1"));
  arkiv.createAttempt = async () => {
    throw new Error("Out of funds");
  };
  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.state, "OPENED");
  assert.equal(lock.openCount, 1);
});

test("only entities created and still owned by the gateway are trusted", () => {
  assert.equal(isTrusted({ $owner: "0xABC", $creator: "0xabc" }, "0xabc"), true);
  assert.equal(isTrusted({ $owner: "0xabc", $creator: "0xbad" }, "0xabc"), false);
  assert.equal(isTrusted({ $owner: "0xbad", $creator: "0xabc" }, "0xabc"), false);
});

test("board creates the locker, extends it, and patches only on change", async () => {
  const arkiv = new MemoryArkiv();
  const board = new LockerBoard(arkiv, "locker-1");
  await board.beat(true);
  assert.deepEqual(arkiv.locker, { key: "locker", lockReachable: true });
  assert.equal(arkiv.extensions, 0);

  await board.beat(true);
  assert.equal(arkiv.extensions, 1);
  assert.equal(arkiv.patches, 0);

  await board.beat(false);
  assert.equal(arkiv.locker!.lockReachable, false);
  assert.equal(arkiv.patches, 1);
});

test("board reuses a live locker after a gateway restart", async () => {
  const arkiv = new MemoryArkiv();
  await new LockerBoard(arkiv, "locker-1").beat(true);
  const restarted = new LockerBoard(arkiv, "locker-1");
  await restarted.beat(false);
  assert.equal(arkiv.locker!.lockReachable, false);
  assert.equal(arkiv.extensions, 1);
});

test("board recreates the locker after it expired, and survives Arkiv outages", async () => {
  const arkiv = new MemoryArkiv();
  const board = new LockerBoard(arkiv, "locker-1");
  await board.beat(true);

  arkiv.down = true;
  await board.beat(true);
  arkiv.down = false;

  arkiv.locker = null;
  await board.beat(true);
  assert.equal(arkiv.locker!.lockReachable, true);
});

test("logged errors name the real cause and never the access key", () => {
  const rpc = Object.assign(new Error("RPC failed\nURL: https://rpc.example/ark_live_5GS-rrEO3"), {
    details: "insufficient funds for gas",
  });
  const top = Object.assign(new Error("Transaction failed"), { cause: rpc });
  assert.equal(errorText(top), "insufficient funds for gas");

  const leaky = new Error("HTTP request failed. URL: https://rpc.example/ark_live_5GS-rrEO3");
  assert.equal(errorText(leaky), "HTTP request failed. URL: https://rpc.example/<access key>");
});
