// Covers the owner's page API, especially that only this machine can use it.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GrantSummary } from "../src/arkiv/backend.ts";
import { hashCode } from "../src/grants.ts";
import { createOwnerApp } from "../src/owner.ts";

const HOST = "localhost:8070";

function setup() {
  const created: { lockerId: string; seconds: number; codeHash: string; label?: string }[] = [];
  const revoked: string[] = [];
  const state = { down: false };
  const list: GrantSummary[] = [{ id: "0xabc", label: "", revoked: false, expiresInSeconds: 60 }];
  const app = createOwnerApp(
    {
      async createGrant(lockerId, seconds, codeHash, label) {
        if (state.down) throw new Error("Arkiv down, https://rpc/ark_live_secretkey");
        created.push({ lockerId, seconds, codeHash, label });
        return "0xnew";
      },
      async revokeGrant(id) {
        if (state.down) throw new Error("Arkiv down");
        revoked.push(id);
      },
      async listGrants() {
        if (state.down) throw new Error("Arkiv down");
        return list;
      },
      async readStatus() {
        return { locker: { lockReachable: true }, attempts: [], decisions: [] };
      },
    },
    { lockerId: "locker-1", port: 8070, kioskUrl: "https://kiosk.example", statusUrl: "http://localhost:8090", gateway: "0xgate" },
  );
  const post = (path: string, body: object, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: "POST",
      headers: { host: HOST, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return { app, post, created, revoked, state };
}

test("creating access stores only a hash, and the link holds the code", async () => {
  const { post, created } = setup();
  const response = await post("/api/grants", { minutes: 10, label: " Parcel " });
  assert.equal(response.status, 201);
  const { id, link, qr } = (await response.json()) as { id: string; link: string; qr: string };
  assert.equal(id, "0xnew");
  assert.ok(qr.startsWith("data:image/svg+xml,"));

  const url = new URL(link);
  assert.equal(url.origin, "https://kiosk.example");
  assert.equal(url.searchParams.get("grant"), "0xnew");
  const code = url.hash.replace("#code=", "");
  assert.ok(code.length >= 22);
  assert.deepEqual(created, [{ lockerId: "locker-1", seconds: 600, codeHash: hashCode(code), label: "Parcel" }]);
});

test("each link gets its own code", async () => {
  const { post, created } = setup();
  await post("/api/grants", { minutes: 10 });
  await post("/api/grants", { minutes: 10 });
  assert.notEqual(created[0]!.codeHash, created[1]!.codeHash);
});

test("bad times and long notes are refused", async () => {
  const { post, created } = setup();
  for (const minutes of [0, -1, 1.5, "10", 999999, null]) {
    assert.equal((await post("/api/grants", { minutes })).status, 400);
  }
  assert.equal((await post("/api/grants", { minutes: 10, label: "x".repeat(41) })).status, 400);
  assert.equal(created.length, 0);
});

test("the list never carries a code or its link", async () => {
  const { app, post } = setup();
  await post("/api/grants", { minutes: 10 });
  const body = await (await app.request("/api/state", { headers: { host: HOST } })).text();
  assert.ok(body.includes("0xabc"));
  assert.ok(!body.includes("code"));
});

test("revoking reaches Arkiv", async () => {
  const { post, revoked } = setup();
  assert.equal((await post("/api/grants/0xabc/revoke", {})).status, 200);
  assert.deepEqual(revoked, ["0xabc"]);
});

test("a request through a tunnel or another hostname is refused", async () => {
  const { app, post, created } = setup();
  const headers = { host: "evil.example" };
  assert.equal((await app.request("/", { headers })).status, 403);
  assert.equal((await app.request("/api/state", { headers })).status, 403);
  assert.equal((await post("/api/grants", { minutes: 10 }, headers)).status, 403);
  assert.equal(created.length, 0);
});

test("another website can't post to it from the same browser", async () => {
  const { app, post, revoked } = setup();
  assert.equal((await post("/api/grants/0xabc/revoke", {}, { origin: "https://evil.example" })).status, 403);
  const form = await app.request("/api/grants/0xabc/revoke", {
    method: "POST",
    headers: { host: HOST, "content-type": "application/x-www-form-urlencoded" },
    body: "x=1",
  });
  assert.equal(form.status, 403);
  assert.equal(revoked.length, 0);
});

test("if Arkiv is down, it says so and doesn't leak details", async () => {
  const { app, post, state } = setup();
  state.down = true;
  const created = await post("/api/grants", { minutes: 10 });
  assert.equal(created.status, 502);
  assert.ok(!(await created.text()).includes("ark_live"));
  assert.equal((await post("/api/grants/0xabc/revoke", {})).status, 502);
  assert.equal((await app.request("/api/state", { headers: { host: HOST } })).status, 503);
});
