// Runs the whole flow against the mock lock, covering each demo attack.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ZeroGDecider } from "../src/ai/zerog.ts";
import type { Decider } from "../src/ai/types.ts";
import { FakeDecider } from "../src/dev.ts";
import { GrantStore, hashCode } from "../src/grants.ts";
import { LockClient } from "../src/lock/client.ts";
import { MockLock } from "../src/lock/mock.ts";
import { EpisodeLog, verifyChain } from "../src/log/episode.ts";
import { ATTEMPT_TTL_MS, LockerService } from "../src/service.ts";

const KEY = Buffer.alloc(32, 7);
const PHOTO = "data:image/jpeg;base64,AAAA";
const CODE = "secret-code";

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
    codeHash: hashCode(CODE),
  });
  const log = new EpisodeLog();
  let clock = Date.now();
  const service = new LockerService({
    lockerId: "locker-1",
    grants,
    decider,
    log,
    lock: new LockClient(url, "locker-1", KEY),
    now: () => clock,
  });

  const verified = (grantId = "g1", code = CODE) => service.create(grantId, code);
  return { lock, grants, log, service, verified, advance: (ms: number) => (clock += ms) };
}

test("happy path: verified person with a passing AI check opens the door", async (t) => {
  const { service, verified, lock, log } = await setup(t);
  const attempt = await verified();
  assert.equal(attempt.state, "AWAITING_PHOTO");
  assert.match(lock.display, /^Do this:\|SHOW /);

  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.state, "OPENED");
  assert.equal(lock.openCount, 1);
  
  const [record] = log.records;
  assert.equal(record!.decision, "OPEN");
  assert.equal(record!.policy, "ALLOW");
  assert.equal(record!.lockAck, "OK");
  assert.ok(record!.requestId);
  assert.ok(verifyChain(log.records));
});

test("wrong code: no challenge, no AI call, and nothing on the display", async (t) => {
  const { service, verified, lock, log } = await setup(t);
  const attempt = await verified("g1", "wrong");
  assert.equal(attempt.state, "DENIED");
  assert.equal(attempt.reason, "BAD_CODE");
  assert.equal(attempt.challenge, null);
  assert.equal(lock.display, "LOCKED");
  assert.equal(lock.openCount, 0);
  assert.equal(log.records.length, 0);
  await assert.rejects(service.submitPhoto(attempt.id, PHOTO), /Cannot accept/);
});

test("unknown grant is refused with no challenge", async (t) => {
  const { verified } = await setup(t);
  const attempt = await verified("nope");
  assert.equal(attempt.reason, "NO_GRANT");
  assert.equal(attempt.challenge, null);
});

test("revoked grant, or one for another locker, is refused at the start", async (t) => {
  const { verified, grants } = await setup(t);
  const grant = (await grants.get("g1"))!;
  grants.put({ ...grant, id: "gone", revoked: true });
  grants.put({ ...grant, id: "other", lockerId: "locker-2" });
  assert.equal((await verified("gone")).reason, "GRANT_REVOKED");
  assert.equal((await verified("other")).reason, "WRONG_LOCKER");
});

test("the same link can be used again after opening", async (t) => {
  const { service, verified, lock } = await setup(t);
  await service.submitPhoto((await verified()).id, PHOTO);
  await service.submitPhoto((await verified()).id, PHOTO);
  assert.equal(lock.openCount, 2);
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

test("prompt injection: a fooled model can't open a grant revoked after the code check", async (t) => {
  const { service, verified, lock, grants } = await setup(t, new FakeDecider("OPEN"));
  const attempt = await verified();
  grants.put({ ...(await grants.get("g1"))!, revoked: true });
  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.reason, "GRANT_REVOKED");
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

test("the AI request doesn't ask for JSON mode, which the default model rejects", async () => {
  let sent: Record<string, unknown> = {};
  const decider = new ZeroGDecider({
    apiKey: "k",
    fetchImpl: (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"decision":"HOLD"}' } }] }));
    }) as unknown as typeof fetch,
  });
  const result = await decider.decide({ challenge: "SHOW A FIST", imageDataUrl: PHOTO });
  assert.equal(result.decision, "HOLD");
  assert.equal(sent.response_format, undefined);
});

test("HOLD: the person gets a new challenge, up to the limit, and each try is logged", async (t) => {
  const { service, verified, lock, log } = await setup(t, new FakeDecider("HOLD"));
  const attempt = await verified();

  for (const left of [2, 1]) {
    const before = attempt.challenge;
    await service.submitPhoto(attempt.id, PHOTO);
    assert.equal(attempt.state, "AWAITING_PHOTO");
    assert.equal(attempt.retrying, true);
    assert.equal(attempt.triesLeft, left);
    assert.notEqual(attempt.challenge, before);
    assert.equal(lock.display, `Do this:|${attempt.challenge}`);
  }

  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.state, "DENIED");
  assert.equal(attempt.reason, "AI_HOLD");
  assert.equal(attempt.retrying, false);
  assert.equal(log.records.length, 3);
  assert.equal(lock.openCount, 0);
  await assert.rejects(service.submitPhoto(attempt.id, PHOTO), /Cannot accept/);
});

test("HOLD then a good photo opens the door", async (t) => {
  const decider = new FakeDecider("HOLD");
  const { service, verified, lock } = await setup(t, decider);
  const attempt = await verified();
  await service.submitPhoto(attempt.id, PHOTO);
  decider.answer = "OPEN";
  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.state, "OPENED");
  assert.equal(attempt.retrying, false);
  assert.equal(lock.openCount, 1);
});

test("only a HOLD earns a retry: ALERT and an outage end the attempt", async (t) => {
  for (const answer of ["ALERT", "DOWN"] as const) {
    const { service, verified } = await setup(t, new FakeDecider(answer));
    const attempt = await verified();
    await service.submitPhoto(attempt.id, PHOTO);
    assert.equal(attempt.state, "DENIED");
  }
});

test("a retry doesn't extend the attempt, and an expired one is refused", async (t) => {
  const { service, verified, advance } = await setup(t, new FakeDecider("HOLD"));
  const attempt = await verified();
  await service.submitPhoto(attempt.id, PHOTO);
  advance(ATTEMPT_TTL_MS);
  await service.submitPhoto(attempt.id, PHOTO);
  assert.equal(attempt.reason, "ATTEMPT_EXPIRED");
});
