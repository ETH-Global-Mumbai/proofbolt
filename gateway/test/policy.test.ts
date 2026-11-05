import assert from "node:assert/strict";
import { test } from "node:test";
import type { Grant } from "../src/grants.ts";
import { evaluate, type PolicyInput } from "../src/policy.ts";

const SUBJECT = { iss: "world", sub: "alice" };
const GRANT: Grant = { id: "g", lockerId: "l", expiresAt: 2000, revoked: false, subject: SUBJECT, enrollable: false };
const BASE: PolicyInput = { now: 1000, attemptExpiresAt: 2000, grant: GRANT, worldSubject: SUBJECT, aiDecision: "OPEN" };

test("allows only when every check passes", () => {
  assert.deepEqual(evaluate(BASE), { allow: true });
});

const denials: [string, Partial<PolicyInput>, string][] = [
  ["expired attempt", { now: 2000, grant: { ...GRANT, expiresAt: 9000 } }, "ATTEMPT_EXPIRED"],
  ["no grant", { grant: null }, "NO_GRANT"],
  ["revoked grant", { grant: { ...GRANT, revoked: true } }, "GRANT_REVOKED"],
  ["expired grant", { grant: { ...GRANT, expiresAt: 500 } }, "GRANT_EXPIRED"],
  ["no World check", { worldSubject: null }, "WORLD_NOT_VERIFIED"],
  ["unenrolled grant", { grant: { ...GRANT, subject: null } }, "GRANT_NOT_ENROLLED"],
  ["wrong person", { worldSubject: { iss: "world", sub: "mallory" } }, "WRONG_PERSON"],
  ["same sub, other issuer", { worldSubject: { iss: "other", sub: "alice" } }, "WRONG_PERSON"],
  ["AI unavailable", { aiDecision: null }, "AI_UNAVAILABLE"],
  ["AI hold", { aiDecision: "HOLD" }, "AI_HOLD"],
  ["AI alert", { aiDecision: "ALERT" }, "AI_ALERT"],
];

for (const [name, change, reason] of denials) {
  test(`denies: ${name}`, () => {
    assert.deepEqual(evaluate({ ...BASE, ...change }), { allow: false, reason });
  });
}

test("a fooled model saying OPEN can't get past missing checks", () => {
  const result = evaluate({ ...BASE, worldSubject: { iss: "world", sub: "mallory" }, aiDecision: "OPEN" });
  assert.equal(result.allow, false);
});
