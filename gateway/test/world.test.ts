// Signed local fixtures, as World's testing guide suggests. Live sandbox checks are still needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { WorldOidc } from "../src/world/oidc.ts";

const ISSUER = "https://issuer.test";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const otherKey = (await generateKeyPair("RS256")).privateKey;
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k", alg: "RS256" }] });

type Claims = Record<string, unknown>;

async function sign(claims: Claims, key = privateKey) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k" })
    .setIssuer((claims.iss as string) ?? ISSUER)
    .setAudience((claims.aud as string) ?? "client")
    .setSubject("alice")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

function client(idToken: string | null, tokenStatus = 200, acceptedAcr?: string[]) {
  const requests: { url: string; body: string; auth: string | null }[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
      });
    }
    requests.push({ url, body: String(init?.body), auth: new Headers(init?.headers).get("authorization") });
    return Response.json(idToken ? { id_token: idToken } : {}, { status: tokenStatus });
  }) as typeof fetch;
  const world = new WorldOidc({
    issuer: ISSUER,
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://app.test/cb",
    acceptedAcr,
    keys,
    fetchImpl,
  });
  return { world, requests };
}

async function attempt(makeClaims: (nonce: string, now: number) => Claims, key = privateKey, acr?: string[]) {
  const { world: starter } = client(null);
  const { url, pending } = await starter.start();
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(makeClaims(pending.nonce, now), key);
  const { world, requests } = client(token, 200, acr);
  return { url, pending, requests, finish: () => world.finish("code", pending) };
}

test("requests fresh authentication with PKCE", async () => {
  const { url } = await attempt((nonce, now) => ({ nonce, auth_time: now }));
  const params = new URL(url).searchParams;
  assert.equal(params.get("max_age"), "0");
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.get("scope"), "openid");
  assert.ok(params.get("state") && params.get("nonce") && params.get("code_challenge"));
});

test("accepts a valid token and sends the verifier", async () => {
  const run = await attempt((nonce, now) => ({ nonce, auth_time: now }));
  assert.deepEqual(await run.finish(), { iss: ISSUER, sub: "alice" });
  assert.match(run.requests[0]!.body, new RegExp(`code_verifier=${run.pending.codeVerifier}`));
  assert.match(run.requests[0]!.auth!, /^Basic /);
});

const rejections: [string, (nonce: string, now: number) => Claims, RegExp][] = [
  ["wrong nonce", (_nonce, now) => ({ nonce: "other", auth_time: now }), /nonce/],
  ["old authentication", (nonce, now) => ({ nonce, auth_time: now - 600 }), /predates/],
  ["future authentication", (nonce, now) => ({ nonce, auth_time: now + 600 }), /future/],
  ["missing auth_time", (nonce) => ({ nonce }), /auth_time/],
  ["wrong audience", (nonce, now) => ({ nonce, auth_time: now, aud: "someone-else" }), /aud/],
  ["wrong issuer", (nonce, now) => ({ nonce, auth_time: now, iss: "https://evil.test" }), /iss/],
];

for (const [name, claims, message] of rejections) {
  test(`rejects: ${name}`, async () => {
    const run = await attempt(claims);
    await assert.rejects(run.finish(), message);
  });
}

test("rejects: token signed by another key", async () => {
  const run = await attempt((nonce, now) => ({ nonce, auth_time: now }), otherKey);
  await assert.rejects(run.finish());
});

test("rejects: unsigned token", async () => {
  const { world: starter } = client(null);
  const { pending } = await starter.start();
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const forged = `${encode({ alg: "none" })}.${encode({
    iss: ISSUER,
    aud: "client",
    sub: "mallory",
    nonce: pending.nonce,
    auth_time: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  })}.`;
  await assert.rejects(client(forged).world.finish("code", pending));
});

test("rejects: an acr outside the accepted list", async () => {
  const run = await attempt((nonce, now) => ({ nonce, auth_time: now, acr: "weak" }), privateKey, ["strong"]);
  await assert.rejects(run.finish(), /acr/);
});

test("rejects: failed token exchange", async () => {
  const { world, } = client(null, 400);
  const { pending } = await client(null).world.start();
  await assert.rejects(world.finish("code", pending), /HTTP 400/);
});
