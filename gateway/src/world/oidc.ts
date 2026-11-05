// World ID step-up over OpenID Connect: https://auth.world.org/docs/guides/step-up
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Subject } from "../grants.ts";
import type { PendingWorldCheck, WorldProvider } from "./types.ts";

const CLOCK_TOLERANCE_SECONDS = 30;
const MAX_CHECK_AGE_SECONDS = 300;

export const SANDBOX_ISSUER = "https://sandbox.auth.world.org";

export interface WorldOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** If set, the token's `acr` must be exactly one of these. */
  acceptedAcr?: string[];
  fetchImpl?: typeof fetch;
  /** Replaces the issuer's published keys, for signed local test fixtures. */
  keys?: JWTVerifyGetKey;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export class WorldOidc implements WorldProvider {
  private discovery: Discovery | null = null;
  private keys: JWTVerifyGetKey | null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: WorldOptions) {
    this.keys = options.keys ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async discover(): Promise<Discovery> {
    if (this.discovery) return this.discovery;
    const response = await this.fetchImpl(`${this.options.issuer}/.well-known/openid-configuration`);
    if (!response.ok) throw new Error(`World discovery failed: HTTP ${response.status}`);
    const discovery = (await response.json()) as Discovery;
    if (discovery.issuer !== this.options.issuer) throw new Error("World discovery issuer mismatch");
    this.discovery = discovery;
    this.keys ??= createRemoteJWKSet(new URL(discovery.jwks_uri));
    return discovery;
  }

  async start(): Promise<{ url: string; pending: PendingWorldCheck }> {
    const discovery = await this.discover();
    const pending: PendingWorldCheck = {
      state: randomToken(),
      nonce: randomToken(),
      codeVerifier: randomToken(),
      startedAtSeconds: Math.floor(Date.now() / 1000),
    };
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      scope: "openid",
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: createHash("sha256").update(pending.codeVerifier).digest("base64url"),
      code_challenge_method: "S256",
      max_age: "0",
    }).toString();
    return { url: url.toString(), pending };
  }

  async finish(code: string, pending: PendingWorldCheck): Promise<Subject> {
    const discovery = await this.discover();
    const basic = Buffer.from(
      `${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.clientSecret)}`,
    ).toString("base64");
    const response = await this.fetchImpl(discovery.token_endpoint, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.options.redirectUri,
        code_verifier: pending.codeVerifier,
      }),
    });
    if (!response.ok) throw new Error(`World token exchange failed: HTTP ${response.status}`);
    const { id_token: idToken } = (await response.json()) as { id_token?: string };
    if (!idToken) throw new Error("World token response had no id_token");

    const { payload } = await jwtVerify(idToken, this.keys!, {
      issuer: discovery.issuer,
      audience: this.options.clientId,
      algorithms: ["RS256"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });

    if (payload.nonce !== pending.nonce) throw new Error("World token nonce mismatch");
    if (!payload.sub) throw new Error("World token has no subject");

    const authTime = payload.auth_time;
    if (typeof authTime !== "number") throw new Error("World token has no auth_time");
    const now = Math.floor(Date.now() / 1000);
    if (authTime < pending.startedAtSeconds - CLOCK_TOLERANCE_SECONDS) {
      throw new Error("World authentication predates this attempt");
    }
    if (authTime > now + CLOCK_TOLERANCE_SECONDS) throw new Error("World auth_time is in the future");
    if (now - pending.startedAtSeconds > MAX_CHECK_AGE_SECONDS) throw new Error("World check took too long");

    const { acceptedAcr } = this.options;
    if (acceptedAcr && !acceptedAcr.includes(String(payload.acr))) {
      throw new Error(`World acr not accepted: ${String(payload.acr)}`);
    }
    return { iss: discovery.issuer, sub: payload.sub };
  }
}
