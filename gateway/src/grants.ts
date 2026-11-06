// A grant is permission to open one locker, proved by holding its secret code. Only a hash of the
// code is ever stored, so reading a grant doesn't reveal how to use it.
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface Grant {
  id: string;
  lockerId: string;
  expiresAt: number;
  revoked: boolean;
  codeHash: string;
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function codeMatches(grant: Grant, code: string): boolean {
  const expected = Buffer.from(grant.codeHash, "utf8");
  const actual = Buffer.from(hashCode(code), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface GrantBook {
  /** Throws if the source of grants can't answer, which must keep the door shut. */
  get(id: string): Promise<Grant | null>;
}

/** For running with DEV_MOCKS=1 and no Arkiv wallet. */
export class GrantStore implements GrantBook {
  private grants = new Map<string, Grant>();

  constructor(private readonly path: string | null = null) {
    if (path && existsSync(path)) {
      for (const grant of JSON.parse(readFileSync(path, "utf8")) as Grant[]) this.grants.set(grant.id, grant);
    }
  }

  async get(id: string): Promise<Grant | null> {
    return this.grants.get(id) ?? null;
  }

  put(grant: Grant): void {
    this.grants.set(grant.id, grant);
    if (this.path) writeFileSync(this.path, JSON.stringify([...this.grants.values()], null, 2));
  }
}
