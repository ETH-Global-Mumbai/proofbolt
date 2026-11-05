import type { Subject } from "../grants.ts";

export interface PendingWorldCheck {
  state: string;
  nonce: string;
  codeVerifier: string;
  startedAtSeconds: number;
}

export interface WorldProvider {
  start(): Promise<{ url: string; pending: PendingWorldCheck }>;
  /** Redeems the code and validates the token. Throws if anything fails to check out. */
  finish(code: string, pending: PendingWorldCheck): Promise<Subject>;
}
