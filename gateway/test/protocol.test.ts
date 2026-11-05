import assert from "node:assert/strict";
import { test } from "node:test";
import { LockClient } from "../src/lock/client.ts";
import { MockLock } from "../src/lock/mock.ts";
import { commandMessage, hmacHex } from "../src/lock/protocol.ts";

const KEY = Buffer.alloc(32);
KEY.set([1, 2, 3, 4, 5, 6, 7, 8]);

test("signs the same bytes as the firmware", () => {
  // Shared with firmware/test/gate_test.cpp.
  const mac = hmacHex(KEY, commandMessage("locker-1", "000102030405060708090a0b0c0d0e0f", "OPEN", ""));
  assert.equal(mac, "8817021fd8ae384c90893eecce7f66b324cfe85e0c987fd21fa70de13857378c");
});

test("a signed command opens the lock once and a replay is rejected", async () => {
  const lock = new MockLock("locker-1", KEY);
  const url = await lock.listen();
  try {
    assert.deepEqual(await new LockClient(url, "locker-1", KEY).send("OPEN"), { ok: true });
    assert.equal(lock.openCount, 1);

    const replay = await fetch(`${url}/cmd`, { method: "POST", body: lock.lastCommandForm!.toString() });
    assert.equal(replay.status, 403);
    assert.equal(lock.openCount, 1);
  } finally {
    await lock.close();
  }
});

test("a command signed with the wrong key does not open the lock", async () => {
  const lock = new MockLock("locker-1", KEY);
  const url = await lock.listen();
  try {
    const result = await new LockClient(url, "locker-1", Buffer.alloc(32, 9)).send("OPEN");
    assert.deepEqual(result, { ok: false, error: "BAD_MAC" });
    assert.equal(lock.openCount, 0);
  } finally {
    await lock.close();
  }
});

test("overlapping commands are queued and all succeed", async () => {
  const lock = new MockLock("locker-1", KEY);
  const url = await lock.listen();
  try {
    const client = new LockClient(url, "locker-1", KEY);
    const results = await Promise.all([client.send("PING"), client.send("OPEN"), client.send("PING")]);
    assert.ok(results.every((result) => result.ok));
    assert.equal(lock.openCount, 1);
  } finally {
    await lock.close();
  }
});

test("an unreachable lock is reported, not thrown", async () => {
  const result = await new LockClient("http://127.0.0.1:1", "locker-1", KEY, 500).send("OPEN");
  assert.equal(result.ok, false);
});
