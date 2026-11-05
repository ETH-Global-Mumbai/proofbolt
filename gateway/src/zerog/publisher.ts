// Copies each decision to 0G Storage, anchors it on 0G Chain, then points to it from Arkiv.
// It runs beside the door and never affects it. Progress is saved after every step, so a failure
// or restart picks up where it stopped without paying for an upload twice.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { errorText } from "../log/errors.ts";
import type { ChainedRecord, EpisodeLog } from "../log/episode.ts";

export interface DecisionStore {
  upload(bytes: Uint8Array): Promise<{ rootHash: string; txHash: string }>;
}

export interface DecisionChain {
  anchor(recordHash: string, storageRoot: string): Promise<string>;
}

export interface DecisionPointer {
  lockerId: string;
  attemptId: string;
  storageRoot: string;
  anchorTx: string;
  at: number;
}

export interface DecisionNotifier {
  decisionStored(pointer: DecisionPointer): Promise<void>;
}

interface Progress {
  rootHash?: string;
  uploadTx?: string;
  anchorTx?: string;
  notified?: boolean;
}

export class EpisodePublisher {
  private progress: Record<string, Progress> = {};
  private running = false;

  constructor(
    private readonly log: EpisodeLog,
    private readonly store: DecisionStore,
    private readonly chain: DecisionChain,
    private readonly notifier: DecisionNotifier | null = null,
    private readonly path: string | null = null,
  ) {
    if (path && existsSync(path)) this.progress = JSON.parse(readFileSync(path, "utf8")) as Record<string, Progress>;
  }

  /** Publishes in log order and stops at the first failure, to retry on the next call. Never throws. */
  async sync(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const record of this.log.records) await this.publish(record);
    } catch (error) {
      console.warn(`[0g] will retry publishing: ${errorText(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async publish(record: ChainedRecord): Promise<void> {
    const progress = (this.progress[record.hash] ??= {});
    if (!progress.rootHash) {
      const { rootHash, txHash } = await this.store.upload(new TextEncoder().encode(JSON.stringify(record)));
      progress.rootHash = rootHash;
      progress.uploadTx = txHash;
      this.save();
      console.log(`[0g] stored decision ${record.attemptId} at ${rootHash}`);
    }
    if (!progress.anchorTx) {
      progress.anchorTx = await this.chain.anchor(`0x${record.hash}`, progress.rootHash);
      this.save();
      console.log(`[0g] anchored decision ${record.attemptId} in ${progress.anchorTx}`);
    }
    if (this.notifier && !progress.notified) {
      await this.notifier.decisionStored({
        lockerId: record.lockerId,
        attemptId: record.attemptId,
        storageRoot: progress.rootHash,
        anchorTx: progress.anchorTx,
        at: Date.parse(record.at),
      });
      progress.notified = true;
      this.save();
    }
  }

  private save(): void {
    if (this.path) writeFileSync(this.path, JSON.stringify(this.progress, null, 2));
  }
}
