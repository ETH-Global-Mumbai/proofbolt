// Every read and write the gateway makes on Arkiv. Only small, expiring state goes here:
// access codes, photos and keys stay off this public store. Grants hold only a hash of the code.
import { createPublicClient, createWalletClient, ExpirationTime, NoEntityFoundError, SchemaMismatchError } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { desc, eq } from "@arkiv-network/sdk/query";
import { bool, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import { formatEther, http, isHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const GrantSchema = defineSchema("proofbolt.grant", {
  lockerId: str().indexed(),
  revoked: bool(),
  codeHash: str(),
});

export const LockerSchema = defineSchema("proofbolt.locker", {
  lockerId: str().indexed(),
  lockReachable: bool(),
});

export const AttemptSchema = defineSchema("proofbolt.attempt", {
  lockerId: str().indexed(),
  attemptId: str(),
  outcome: str().indexed(),
  reason: str(),
  requestId: str(),
  at: u64().indexed(),
});

export const DecisionSchema = defineSchema("proofbolt.decision", {
  lockerId: str().indexed(),
  attemptId: str(),
  storageRoot: str(),
  anchorTx: str(),
  at: u64().indexed(),
});

export const LOCKER_TTL_SECONDS = 60;
const HISTORY_TTL_DAYS = 30;
const RECENT_ATTEMPTS = 20;

export interface GrantEntity {
  lockerId: string;
  revoked: boolean;
  codeHash: string;
}

export interface LockerEntity {
  lockReachable: boolean;
  /** Seconds until Arkiv removes this entity, unless the gateway extends it. */
  expiresInSeconds?: number;
}

export interface AttemptEntity {
  lockerId: string;
  attemptId: string;
  outcome: string;
  reason: string;
  requestId: string;
  at: number;
}

export interface DecisionEntity {
  lockerId: string;
  attemptId: string;
  storageRoot: string;
  anchorTx: string;
  at: number;
}

export interface LockerStatus {
  locker: LockerEntity | null;
  attempts: AttemptEntity[];
  decisions: DecisionEntity[];
}

export interface ArkivReader {
  getGrant(key: string): Promise<GrantEntity | null>;
  findLocker(lockerId: string): Promise<string | null>;
  readStatus(lockerId: string): Promise<LockerStatus>;
}

export interface ArkivWriter {
  createGrant(lockerId: string, expiresInSeconds: number, codeHash: string): Promise<string>;
  revokeGrant(key: string): Promise<void>;
  createLocker(lockerId: string, lockReachable: boolean): Promise<string>;
  patchLocker(key: string, lockReachable: boolean): Promise<void>;
  extendLocker(key: string): Promise<void>;
  createAttempt(attempt: AttemptEntity): Promise<void>;
  createDecision(decision: DecisionEntity): Promise<void>;
}

export type ArkivBackend = ArkivReader & ArkivWriter;

/**
 * Anyone can write to Arkiv, and anyone can hand an entity over to our wallet, which makes us its
 * owner. So only an entity both created and owned by the gateway counts.
 */
export function isTrusted(entity: { $owner: string; $creator: string }, gateway: string): boolean {
  const expected = gateway.toLowerCase();
  return entity.$owner.toLowerCase() === expected && entity.$creator.toLowerCase() === expected;
}

function chain(accessKey: string) {
  return rabdi({ accessKey });
}

export class ArkivRead implements ArkivReader {
  private readonly client;

  /** @param gateway The only wallet whose entities are believed. */
  constructor(accessKey: string, protected readonly gateway: Hex) {
    this.client = createPublicClient({ chain: chain(accessKey), transport: http() });
  }

  /** The wallet's tGLM balance, for telling a funding problem apart from anything else. */
  async balance(): Promise<string> {
    return formatEther(await this.client.getBalance({ address: this.gateway }));
  }

  /** Returns null if there's no such live grant. Throws if Arkiv can't answer. */
  async getGrant(key: string): Promise<GrantEntity | null> {
    if (!isHex(key) || key.length !== 66) return null;
    try {
      const grant = await this.client.getEntity(key, GrantSchema);
      if (!isTrusted(grant, this.gateway)) return null;
      return { lockerId: grant.lockerId.value, revoked: grant.revoked.value, codeHash: grant.codeHash.value };
    } catch (error) {
      if (error instanceof NoEntityFoundError || error instanceof SchemaMismatchError) return null;
      throw error;
    }
  }

  async findLocker(lockerId: string): Promise<string | null> {
    const { entities } = await this.client
      .select({ $key: true })
      .from(LockerSchema)
      .ownedBy(this.gateway)
      .createdBy(this.gateway)
      .where(eq("lockerId", lockerId))
      .limit(1)
      .fetch();
    return entities[0]?.$key ?? null;
  }

  async readStatus(lockerId: string): Promise<LockerStatus> {
    const lockers = await this.client
      .select({ lockReachable: true, $expiresAt: true })
      .from(LockerSchema)
      .ownedBy(this.gateway)
      .createdBy(this.gateway)
      .where(eq("lockerId", lockerId))
      .limit(1)
      .fetch();
    const attempts = await this.client
      .select({ lockerId: true, attemptId: true, outcome: true, reason: true, requestId: true, at: true })
      .from(AttemptSchema)
      .ownedBy(this.gateway)
      .createdBy(this.gateway)
      .where(eq("lockerId", lockerId))
      .orderBy(desc("at"))
      .limit(RECENT_ATTEMPTS)
      .fetch();
    const decisions = await this.client
      .select({ lockerId: true, attemptId: true, storageRoot: true, anchorTx: true, at: true })
      .from(DecisionSchema)
      .ownedBy(this.gateway)
      .createdBy(this.gateway)
      .where(eq("lockerId", lockerId))
      .orderBy(desc("at"))
      .limit(RECENT_ATTEMPTS)
      .fetch();
    const locker = lockers.entities[0];
    const timing = await this.client.getBlockTiming();
    return {
      locker: locker
        ? {
            lockReachable: locker.lockReachable.value,
            expiresInSeconds: Number(locker.$expiresAt - timing.currentBlock) * timing.blockDuration,
          }
        : null,
      attempts: attempts.entities.map((row) => ({
        lockerId: row.lockerId.value,
        attemptId: row.attemptId.value,
        outcome: row.outcome.value,
        reason: row.reason.value,
        requestId: row.requestId.value,
        at: Number(row.at.value),
      })),
      decisions: decisions.entities.map((row) => ({
        lockerId: row.lockerId.value,
        attemptId: row.attemptId.value,
        storageRoot: row.storageRoot.value,
        anchorTx: row.anchorTx.value,
        at: Number(row.at.value),
      })),
    };
  }
}

export class Arkiv extends ArkivRead implements ArkivWriter {
  private readonly wallet;
  /** Writes run one at a time, so two of them never race for the same wallet nonce. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(accessKey: string, privateKey: Hex) {
    const account = privateKeyToAccount(privateKey);
    super(accessKey, account.address);
    this.wallet = createWalletClient({ chain: chain(accessKey), transport: http(), account });
  }

  get address(): Hex {
    return this.gateway;
  }

  private write<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  createGrant(lockerId: string, expiresInSeconds: number, codeHash: string): Promise<string> {
    return this.write(async () => {
      const { entityKey } = await this.wallet.createEntity(
        GrantSchema,
        { lockerId, revoked: false, codeHash },
        { expiration: ExpirationTime.fromSeconds(expiresInSeconds) },
      );
      return entityKey;
    });
  }

  revokeGrant(key: string): Promise<void> {
    return this.write(async () => {
      await this.wallet.patchEntity(GrantSchema, key as Hex, { set: { revoked: true } });
    });
  }

  createLocker(lockerId: string, lockReachable: boolean): Promise<string> {
    return this.write(async () => {
      const { entityKey } = await this.wallet.createEntity(
        LockerSchema,
        { lockerId, lockReachable },
        { expiration: ExpirationTime.fromSeconds(LOCKER_TTL_SECONDS) },
      );
      return entityKey;
    });
  }

  patchLocker(key: string, lockReachable: boolean): Promise<void> {
    return this.write(async () => {
      await this.wallet.patchEntity(LockerSchema, key as Hex, { set: { lockReachable } });
    });
  }

  extendLocker(key: string): Promise<void> {
    return this.write(async () => {
      await this.wallet.extendEntity({ entityKey: key as Hex, expiration: ExpirationTime.fromSeconds(LOCKER_TTL_SECONDS) });
    });
  }

  createAttempt(attempt: AttemptEntity): Promise<void> {
    return this.write(async () => {
      await this.wallet.createEntity(
        AttemptSchema,
        { ...attempt, at: u64(BigInt(attempt.at)) },
        { expiration: ExpirationTime.fromDays(HISTORY_TTL_DAYS) },
      );
    });
  }

  createDecision(decision: DecisionEntity): Promise<void> {
    return this.write(async () => {
      await this.wallet.createEntity(
        DecisionSchema,
        { ...decision, at: u64(BigInt(decision.at)) },
        { expiration: ExpirationTime.fromDays(HISTORY_TTL_DAYS) },
      );
    });
  }
}
