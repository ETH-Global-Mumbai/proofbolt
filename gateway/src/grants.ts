// Local grant store. World identifiers stay in this file and never go on-chain.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface Subject {
  iss: string;
  sub: string;
}

export interface Grant {
  id: string;
  lockerId: string;
  expiresAt: number;
  revoked: boolean;
  /** Set by the first validated World check when `enrollable` is true. */
  subject: Subject | null;
  enrollable: boolean;
}

export class GrantStore {
  private grants = new Map<string, Grant>();

  constructor(private readonly path: string | null = null) {
    if (path && existsSync(path)) {
      for (const grant of JSON.parse(readFileSync(path, "utf8")) as Grant[]) this.grants.set(grant.id, grant);
    }
  }

  get(id: string): Grant | null {
    return this.grants.get(id) ?? null;
  }

  put(grant: Grant): void {
    this.grants.set(grant.id, grant);
    this.save();
  }

  /** Links an identity to an unenrolled grant. Returns false if the grant can't take it. */
  enroll(id: string, subject: Subject): boolean {
    const grant = this.grants.get(id);
    if (!grant || grant.subject || !grant.enrollable) return false;
    const taken = [...this.grants.values()].some(
      (other) => other.subject?.iss === subject.iss && other.subject.sub === subject.sub,
    );
    if (taken) return false;
    grant.subject = subject;
    grant.enrollable = false;
    this.save();
    return true;
  }

  private save(): void {
    if (this.path) writeFileSync(this.path, JSON.stringify([...this.grants.values()], null, 2));
  }
}
