// Hash-chained decision log. It stores what was decided and why, but never photos or World IDs.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
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

function hashRecord(prevHash: string, record: DecisionRecord): string {
  return createHash("sha256").update(prevHash).update(JSON.stringify(record)).digest("hex");
}

export class EpisodeLog {
  readonly records: ChainedRecord[] = [];
  private lastHash = GENESIS;

  constructor(private readonly path: string | null = null) {
    // Picks up the existing file, so a restart continues the chain instead of starting a new one.
    if (path && existsSync(path)) {
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      this.records.push(...lines.map((line) => JSON.parse(line) as ChainedRecord));
      this.lastHash = this.records.at(-1)?.hash ?? GENESIS;
    }
  }

  append(record: DecisionRecord): ChainedRecord {
    const prevHash = this.lastHash;
    const hash = hashRecord(prevHash, record);
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
    const expected = hashRecord(previous, record);
    if (prevHash !== previous || hash !== expected) return false;
    previous = hash;
  }
  return true;
}

/**
 * How a record joins the one before it. A log reset shows up as NEW_LOG, so a replay can point
 * it out. A record whose contents don't match its own hash is BROKEN.
 */
export function linkStatus(record: ChainedRecord, previous: ChainedRecord | null): "OK" | "NEW_LOG" | "BROKEN" {
  const { prevHash, hash, ...fields } = record;
  if (hashRecord(prevHash, fields) !== hash) return "BROKEN";
  if (prevHash === (previous?.hash ?? GENESIS)) return "OK";
  return prevHash === GENESIS ? "NEW_LOG" : "BROKEN";
}
