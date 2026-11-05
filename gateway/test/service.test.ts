// Runs the whole flow against the mock lock, covering each demo attack.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ZeroGDecider } from "../src/ai/zerog.ts";
import type { Decider } from "../src/ai/types.ts";
import { FakeDecider, FakeWorld } from "../src/dev.ts";
import { GrantStore } from "../src/grants.ts";
import { LockClient } from "../src/lock/client.ts";
import { MockLock } from "../src/lock/mock.ts";
import { EpisodeLog, verifyChain } from "../src/log/episode.ts";
import { ATTEMPT_TTL_MS, LockerService } from "../src/service.ts";

const KEY = Buffer.alloc(32, 7);
const PHOTO = "data:image/jpeg;base64,AAAA";

async function setup(t: TestContext, decider: Decider = new FakeDecider()) {
  const lock = new MockLock("locker-1", KEY);
  const url = await lock.listen();
  t.after(() => lock.close());

  const grants = new GrantStore();
  grants.put({
    id: "g1",
    lockerId: "locker-1",
    expiresAt: Date.now() + 3_600_000,
    revoked: false,
    subject: null,
    enrollable: true,
  });
  const world = new FakeWorld({ iss: "world", sub: "alice" });
  const log = new EpisodeLog();
  let clock = Date.now();
  const service = new LockerService({
    lockerId: "locker-1",
    grants,
    world,
    decider,
    log,
    lock: new LockClient(url, "locker-1", KEY),
    now: () => clock,
  });

  async function verified(grantId = "g1") {
    const attempt = service.create(grantId);
    await service.startWorld(attempt.id);
    await service.finishWorld({ state: attempt.pendingWorld!.state, code: "ok" });
    return attempt;
  }
  return { lock, grants, world, log, service, verified, advance: (ms: number) => (clock += ms) };
}

test("happy path: verified person with a passing AI check opens the door", async (t) => {
  const { service, verified, lock, log, grants } = await setup(t);
  const attempt = await verified();
  assert.equal(attempt.state, "AWAITING_PHOTO");
  assert.match(lock.display, /^Do this:\|SHOW /);

  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.state, "OPENED");
  assert.equal(lock.openCount, 1);
  assert.deepEqual((await grants.get("g1"))!.subject, { iss: "world", sub: "alice" });

  const [record] = log.records;
  assert.equal(record!.decision, "OPEN");
  assert.equal(record!.policy, "ALLOW");
  assert.equal(record!.lockAck, "OK");
  assert.ok(record!.requestId);
  assert.ok(verifyChain(log.records));
});

test("World denied: door stays shut and no AI call is made", async (t) => {
  const { service, lock, log } = await setup(t);
  const attempt = service.create("g1");
  await service.startWorld(attempt.id);
  await service.finishWorld({ state: attempt.pendingWorld!.state, error: "access_denied" });
  assert.equal(attempt.state, "DENIED");
  assert.equal(attempt.reason, "WORLD_DENIED");
  assert.equal(lock.openCount, 0);
  assert.equal(lock.display, "DENIED|WORLD_DENIED");
  assert.equal(log.records.length, 0);
});

test("a repeated World callback is ignored", async (t) => {
  const { service } = await setup(t);
  const attempt = service.create("g1");
  await service.startWorld(attempt.id);
  const state = attempt.pendingWorld!.state;
  await service.finishWorld({ state, code: "ok" });
  assert.equal(await service.finishWorld({ state, code: "ok" }), null);
});

test("wrong person: another verified human can't use an enrolled grant", async (t) => {
  const { service, verified, world, lock } = await setup(t);
  const first = await verified();
  await service.submitPhoto(first.id, PHOTO);
  assert.equal(lock.openCount, 1);

  world.subject = { iss: "world", sub: "mallory" };
  const second = await verified();
  assert.equal(second.state, "DENIED");
  assert.equal(second.reason, "WRONG_PERSON");
  assert.equal(lock.openCount, 1);
});

test("a person can't enroll on two grants", async (t) => {
  const { service, verified, grants, lock } = await setup(t);
  grants.put({ id: "g2", lockerId: "locker-1", expiresAt: Date.now() + 1000000, revoked: false, subject: null, enrollable: true });
  await service.submitPhoto((await verified("g1")).id, PHOTO);
  const second = await verified("g2");
  assert.equal(second.reason, "ENROLLMENT_REFUSED");
  assert.equal(lock.openCount, 1);
});

test("printed photo: AI says ALERT and the door stays shut", async (t) => {
  const { service, verified, lock, log } = await setup(t, new FakeDecider("ALERT"));
  const attempt = await verified();
  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.state, "DENIED");
  assert.equal(attempt.reason, "AI_ALERT");
  assert.equal(lock.openCount, 0);
  assert.equal(log.records[0]!.policy, "AI_ALERT");
});

test("prompt injection: a fooled model can't open a grant revoked after verification", async (t) => {
  const { service, verified, lock, grants } = await setup(t, new FakeDecider("OPEN"));
  const attempt = await verified();
  grants.put({ ...(await grants.get("g1"))!, revoked: true });
  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.reason, "GRANT_REVOKED");
  assert.equal(lock.openCount, 0);
});

test("a photo without a World check is refused outright", async (t) => {
  const { service, lock } = await setup(t);
  const attempt = service.create("g1");
  await assert.rejects(service.submitPhoto(attempt.id, PHOTO), /Cannot accept/);
  assert.equal(lock.openCount, 0);
});

test("0G unreachable: safe stop with a null decision and no faked result", async (t) => {
  const { service, verified, lock, log } = await setup(t, new FakeDecider("DOWN"));
  const attempt = await verified();
  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.reason, "0G_UNREACHABLE");
  assert.equal(lock.openCount, 0);
  assert.equal(lock.display, "SAFE STOP 0G unreachable");
  assert.equal(log.records[0]!.decision, null);
  assert.equal(log.records[0]!.aiStatus, "0G_UNREACHABLE");
});

test("attempt can't be used twice, even by simultaneous requests", async (t) => {
  const { service, verified, lock } = await setup(t);
  const attempt = await verified();
  const results = await Promise.allSettled([service.submitPhoto(attempt.id, PHOTO), service.submitPhoto(attempt.id, PHOTO)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(lock.openCount, 1);
  await assert.rejects(service.submitPhoto(attempt.id, PHOTO));
  assert.equal(lock.openCount, 1);
});

test("an expired attempt stays shut", async (t) => {
  const { service, verified, advance, lock } = await setup(t);
  const attempt = await verified();
  advance(ATTEMPT_TTL_MS + 1);
  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.reason, "ATTEMPT_EXPIRED");
  assert.equal(lock.openCount, 0);
});

test("lock offline: the attempt is denied and logged, not reported as opened", async (t) => {
  const { service, verified, lock, log } = await setup(t);
  const attempt = await verified();
  await lock.close();
  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.state, "DENIED");
  assert.equal(attempt.reason, "LOCK_UNREACHABLE");
  assert.match(log.records[0]!.lockAck, /LOCK_UNREACHABLE/);
});

function routerDecider(response: () => Response | Promise<Response>) {
  return new ZeroGDecider({ apiKey: "k", fetchImpl: (async () => response()) as typeof fetch });
}

function routerReply(content: string, extra: object = {}) {
  return Response.json({
    choices: [{ message: { content } }],
    x_0g_trace: { request_id: "req-1", provider: "0xabc", billing: { total_cost: "12" }, ...extra },
  });
}

test("0G adapter: reads the decision and the trace", async () => {
  const result = await routerDecider(() => routerReply('{"decision":"OPEN"}', { tee_verified: true })).decide({ challenge: "c", imageDataUrl: PHOTO });
  assert.equal(result.decision, "OPEN");
  assert.equal(result.requestId, "req-1");
  assert.equal(result.provider, "0xabc");
  assert.equal(result.teeVerified, true);
});

for (const [name, content] of [
  ["text outside the enum", '{"decision":"UNLOCK_NOW"}'],
  ["not JSON", "OPEN"],
  ["empty", ""],
]) {
  test(`0G adapter: ${name} gives no decision`, async () => {
    const result = await routerDecider(() => routerReply(content!)).decide({ challenge: "c", imageDataUrl: PHOTO });
    assert.equal(result.status, "INVALID_OUTPUT");
    assert.equal(result.decision, null);
  });
}

for (const status of [402, 429, 500]) {
  test(`0G adapter: HTTP ${status} counts as unreachable`, async () => {
    const result = await routerDecider(() => new Response("no", { status })).decide({ challenge: "c", imageDataUrl: PHOTO });
    assert.equal(result.status, "0G_UNREACHABLE");
    assert.equal(result.decision, null);
  });
}

test("0G adapter: a network failure counts as unreachable", async () => {
  const result = await routerDecider(() => { throw new TypeError("fetch failed"); }).decide({ challenge: "c", imageDataUrl: PHOTO });
  assert.equal(result.status, "0G_UNREACHABLE");
});

test("log: tampering breaks the chain", async (t) => {
  const { service, verified, log } = await setup(t);
  await service.submitPhoto((await verified()).id, PHOTO);
  assert.ok(verifyChain(log.records));
  log.records[0]!.decision = "HOLD";
  assert.equal(verifyChain(log.records), false);
});
