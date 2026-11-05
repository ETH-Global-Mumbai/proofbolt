// Covers publishing decisions to 0G, and the log surviving a restart.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseDecision } from "../src/ai/zerog.ts";
import { parsePhotoName } from "../src/zerog/cli.ts";
import { EpisodeLog, linkStatus, verifyChain, type DecisionRecord } from "../src/log/episode.ts";
import { EpisodePublisher, type DecisionPointer } from "../src/zerog/publisher.ts";

function decision(attemptId: string): DecisionRecord {
  return {
    attemptId,
    lockerId: "locker-1",
    at: "2026-11-05T10:00:00.000Z",
    challenge: "SHOW A FIST",
    imageSha256: "ab",
    aiStatus: "OK",
    decision: "OPEN",
    requestId: `req-${attemptId}`,
    provider: "p",
    totalCost: "0",
    teeVerified: null,
    policy: "ALLOW",
    lockAck: "OK",
  };
}

class FakeZeroG {
  uploads: string[] = [];
  anchors: [string, string][] = [];
  pointers: DecisionPointer[] = [];
  failUpload = false;
  failAnchor = false;
  failNotify = false;

  async upload(bytes: Uint8Array) {
    if (this.failUpload) throw new Error("Out of funds");
    const text = new TextDecoder().decode(bytes);
    this.uploads.push(text);
    return { rootHash: `0xroot${this.uploads.length}`, txHash: "0xupload" };
  }
  async anchor(recordHash: string, storageRoot: string) {
    if (this.failAnchor) throw new Error("RPC down");
    this.anchors.push([recordHash, storageRoot]);
    return `0xanchor${this.anchors.length}`;
  }
  async decisionStored(pointer: DecisionPointer) {
    if (this.failNotify) throw new Error("Arkiv down");
    this.pointers.push(pointer);
  }
}

function tempDir(t: { after(fn: () => void): void }): string {
  const directory = mkdtempSync(join(tmpdir(), "proofbolt-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("a decision is stored in full, anchored, then pointed to from Arkiv", async () => {
  const log = new EpisodeLog();
  const record = log.append(decision("a"));
  const zerog = new FakeZeroG();
  await new EpisodePublisher(log, zerog, zerog, zerog).sync();

  assert.deepEqual(JSON.parse(zerog.uploads[0]!), record);
  assert.ok(zerog.uploads[0]!.includes("req-a"));
  assert.deepEqual(zerog.anchors, [[`0x${record.hash}`, "0xroot1"]]);
  assert.equal(zerog.pointers[0]!.attemptId, "a");
  assert.equal(zerog.pointers[0]!.storageRoot, "0xroot1");
  assert.equal(zerog.pointers[0]!.anchorTx, "0xanchor1");
});

test("a second sync publishes nothing new", async () => {
  const log = new EpisodeLog();
  log.append(decision("a"));
  const zerog = new FakeZeroG();
  const publisher = new EpisodePublisher(log, zerog, zerog, zerog);
  await publisher.sync();
  await publisher.sync();
  assert.equal(zerog.uploads.length, 1);
  assert.equal(zerog.anchors.length, 1);
  assert.equal(zerog.pointers.length, 1);
});

test("a failed upload never throws, and keeps decisions in order", async () => {
  const log = new EpisodeLog();
  log.append(decision("a"));
  log.append(decision("b"));
  const zerog = new FakeZeroG();
  const publisher = new EpisodePublisher(log, zerog, zerog, zerog);

  zerog.failUpload = true;
  await publisher.sync();
  assert.equal(zerog.anchors.length, 0);

  zerog.failUpload = false;
  await publisher.sync();
  assert.deepEqual(zerog.pointers.map((p) => p.attemptId), ["a", "b"]);
});

test("a failed anchor retries without paying for the upload again", async () => {
  const log = new EpisodeLog();
  log.append(decision("a"));
  const zerog = new FakeZeroG();
  const publisher = new EpisodePublisher(log, zerog, zerog, zerog);

  zerog.failAnchor = true;
  await publisher.sync();
  zerog.failAnchor = false;
  await publisher.sync();
  assert.equal(zerog.uploads.length, 1);
  assert.equal(zerog.anchors.length, 1);
});

test("a failed Arkiv pointer retries without anchoring again", async () => {
  const log = new EpisodeLog();
  log.append(decision("a"));
  const zerog = new FakeZeroG();
  const publisher = new EpisodePublisher(log, zerog, zerog, zerog);

  zerog.failNotify = true;
  await publisher.sync();
  zerog.failNotify = false;
  await publisher.sync();
  assert.equal(zerog.anchors.length, 1);
  assert.equal(zerog.pointers.length, 1);
});

test("overlapping syncs don't publish twice", async () => {
  const log = new EpisodeLog();
  log.append(decision("a"));
  const zerog = new FakeZeroG();
  const publisher = new EpisodePublisher(log, zerog, zerog, zerog);
  await Promise.all([publisher.sync(), publisher.sync()]);
  assert.equal(zerog.uploads.length, 1);
});

test("progress survives a restart", async (t) => {
  const directory = tempDir(t);
  const state = join(directory, "published.json");
  const log = new EpisodeLog();
  log.append(decision("a"));
  const zerog = new FakeZeroG();
  zerog.failAnchor = true;
  await new EpisodePublisher(log, zerog, zerog, zerog, state).sync();

  zerog.failAnchor = false;
  await new EpisodePublisher(log, zerog, zerog, zerog, state).sync();
  assert.equal(zerog.uploads.length, 1);
  assert.equal(zerog.anchors.length, 1);
});

test("the log continues its chain after a restart", (t) => {
  const path = join(tempDir(t), "episode.jsonl");
  new EpisodeLog(path).append(decision("a"));
  const restarted = new EpisodeLog(path);
  restarted.append(decision("b"));
  assert.equal(restarted.records.length, 2);
  assert.ok(verifyChain(restarted.records));
});

test("replay spots an edited record, a dropped record and a log reset", () => {
  const log = new EpisodeLog();
  const first = log.append(decision("a"));
  const second = log.append(decision("b"));
  const third = log.append(decision("c"));

  assert.equal(linkStatus(first, null), "OK");
  assert.equal(linkStatus(second, first), "OK");
  assert.equal(linkStatus({ ...second, policy: "ALLOW-EDITED" }, first), "BROKEN");
  assert.equal(linkStatus(third, first), "BROKEN");

  const fresh = new EpisodeLog().append(decision("d"));
  assert.equal(linkStatus(fresh, third), "NEW_LOG");
});

test("AI output: reasoning and code fences are tolerated, anything else isn't an answer", () => {
  assert.equal(parseDecision('{"decision":"OPEN"}'), "OPEN");
  assert.equal(parseDecision('```json\n{"decision":"HOLD"}\n```'), "HOLD");
  assert.equal(parseDecision('<think>a fist?</think>\n{"decision":"ALERT"}'), "ALERT");
  assert.equal(parseDecision('Sure! {"decision":"OPEN"}'), null);
  assert.equal(parseDecision('{"decision":"OPEN"} {"decision":"OPEN"}'), null);
  assert.equal(parseDecision('{"decision":"UNLOCK"}'), null);
  assert.equal(parseDecision("OPEN"), null);
});

test("photo names give the challenge and the expected answer", () => {
  assert.deepEqual(parsePhotoName("show-a-fist__OPEN.jpg"), { challenge: "SHOW A FIST", expected: "OPEN" });
  assert.deepEqual(parsePhotoName("show-2-fingers__hold-2.jpeg"), { challenge: "SHOW 2 FINGERS", expected: "HOLD" });
  assert.equal(parsePhotoName("notes.txt"), null);
  assert.equal(parsePhotoName("show-a-fist.jpg"), null);
});
