import assert from "node:assert/strict";
import { test } from "node:test";
import type { Grant } from "../src/grants.ts";
import { evaluate, type PolicyInput } from "../src/policy.ts";

const GRANT: Grant = { id: "g", lockerId: "l", expiresAt: 2000, revoked: false, codeHash: "h" };
const BASE: PolicyInput = { now: 1000, lockerId: "l", attemptExpiresAt: 2000, grant: GRANT, codeVerified: true, aiDecision: "OPEN" };

test("allows only when every check passes", () => {
  assert.deepEqual(evaluate(BASE), { allow: true });
});

const denials: [string, Partial<PolicyInput>, string][] = [
  ["expired attempt", { now: 2000, grant: { ...GRANT, expiresAt: 9000 } }, "ATTEMPT_EXPIRED"],
  ["no grant", { grant: null }, "NO_GRANT"],
  ["grant for another locker", { lockerId: "other" }, "WRONG_LOCKER"],
  ["revoked grant", { grant: { ...GRANT, revoked: true } }, "GRANT_REVOKED"],
  ["expired grant", { grant: { ...GRANT, expiresAt: 500 } }, "GRANT_EXPIRED"],
  ["no code check", { codeVerified: false }, "CODE_NOT_VERIFIED"],
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
  const result = evaluate({ ...BASE, codeVerified: false, aiDecision: "OPEN" });
  assert.equal(result.allow, false);
});
