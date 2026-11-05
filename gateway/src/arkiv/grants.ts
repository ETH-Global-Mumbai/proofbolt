// Grants live on Arkiv, so expiring or revoking one takes effect with no gateway change.
// The World ID linked to each grant stays in a local file and never goes on Arkiv.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Grant, GrantBook, Subject } from "../grants.ts";
import type { ArkivBackend } from "./backend.ts";

export class ArkivGrants implements GrantBook {
  private enrollments = new Map<string, Subject>();

  constructor(
    private readonly arkiv: ArkivBackend,
    private readonly path: string | null = null,
  ) {
    if (path && existsSync(path)) {
      this.enrollments = new Map(Object.entries(JSON.parse(readFileSync(path, "utf8")) as Record<string, Subject>));
    }
  }

  async get(id: string): Promise<Grant | null> {
    const entity = await this.arkiv.getGrant(id);
    if (!entity) return null;
    const subject = this.enrollments.get(id) ?? null;
    return {
      id,
      lockerId: entity.lockerId,
      // Arkiv removes a grant when it expires, so a grant that can still be read is in date.
      expiresAt: Number.POSITIVE_INFINITY,
      revoked: entity.revoked,
      subject,
      // `enrolled` is on Arkiv so that losing the local file can't reopen a grant to a new person.
      enrollable: !subject && !entity.enrolled,
    };
  }

  async enroll(id: string, subject: Subject): Promise<boolean> {
    const grant = await this.get(id);
    if (!grant?.enrollable || grant.revoked) return false;
    if (!(await this.identityIsFree(subject))) return false;
    // A second person racing for this grant finds it taken once this line has run.
    if (this.enrollments.has(id)) return false;
    this.enrollments.set(id, subject);
    try {
      await this.arkiv.patchGrant(id, { enrolled: true });
    } catch (error) {
      this.enrollments.delete(id);
      throw error;
    }
    this.save();
    return true;
  }

  /** A person keeps one live grant. A grant that has expired or been revoked frees them. */
  private async identityIsFree(subject: Subject): Promise<boolean> {
    for (const [otherId, other] of this.enrollments) {
      if (other.iss !== subject.iss || other.sub !== subject.sub) continue;
      const entity = await this.arkiv.getGrant(otherId);
      if (entity && !entity.revoked) return false;
      this.enrollments.delete(otherId);
    }
    return true;
  }

  private save(): void {
    if (this.path) writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.enrollments), null, 2));
  }
}
