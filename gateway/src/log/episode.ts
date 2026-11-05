// Hash-chained decision log. It stores what was decided and why, but never photos or World IDs.
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import type { AiStatus, AiDecision } from "../ai/types.ts";

export interface DecisionRecord {
  attemptId: string;
  lockerId: string;
  at: string;
  challenge: string;
  /** Hash of the photo, so a stored copy can be matched without keeping the photo. */
  imageSha256: string;
  aiStatus: AiStatus;
  decision: AiDecision | null;
  requestId: string | null;
  provider: string | null;
  totalCost: string | null;
  teeVerified: boolean | null;
  policy: string;
  lockAck: string;
}

export interface ChainedRecord extends DecisionRecord {
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

export class EpisodeLog {
  readonly records: ChainedRecord[] = [];
  private lastHash = GENESIS;

  constructor(private readonly path: string | null = null) {}

  append(record: DecisionRecord): ChainedRecord {
    const prevHash = this.lastHash;
    const hash = createHash("sha256").update(prevHash).update(JSON.stringify(record)).digest("hex");
    const chained: ChainedRecord = { ...record, prevHash, hash };
    this.records.push(chained);
    this.lastHash = hash;
    if (this.path) appendFileSync(this.path, `${JSON.stringify(chained)}\n`);
    return chained;
  }
}

export function verifyChain(records: ChainedRecord[]): boolean {
  let previous = GENESIS;
  for (const { prevHash, hash, ...record } of records) {
    const expected = createHash("sha256").update(previous).update(JSON.stringify(record)).digest("hex");
    if (prevHash !== previous || hash !== expected) return false;
    previous = hash;
  }
  return true;
}
