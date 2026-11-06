// Grants live on Arkiv, so expiring or revoking one takes effect with no gateway change.
import type { Grant, GrantBook } from "../grants.ts";
import type { ArkivReader } from "./backend.ts";

export class ArkivGrants implements GrantBook {
  constructor(private readonly arkiv: Pick<ArkivReader, "getGrant">) {}

  async get(id: string): Promise<Grant | null> {
    const entity = await this.arkiv.getGrant(id);
    if (!entity) return null;
    return {
      id,
      lockerId: entity.lockerId,
      // Arkiv removes a grant when it expires, so a grant that can still be read is in date.
      expiresAt: Number.POSITIVE_INFINITY,
      revoked: entity.revoked,
      codeHash: entity.codeHash,
    };
  }
}
