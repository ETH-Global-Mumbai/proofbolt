// Publishes what the status page shows. The locker entity lives only while the gateway keeps
// extending it, so a dead gateway drops off the page by itself.
import { errorText } from "../log/errors.ts";
import type { DecisionNotifier, DecisionPointer } from "../zerog/publisher.ts";
import type { AttemptEntity, ArkivBackend } from "./backend.ts";

export const BOARD_BEAT_MS = 20_000;

export class LockerBoard implements DecisionNotifier {
  private key: string | null = null;
  private published: boolean | null = null;
  private busy = false;

  constructor(
    private readonly arkiv: ArkivBackend,
    private readonly lockerId: string,
  ) {}

  /** Never throws: a failed status write must not affect the door. */
  async beat(lockReachable: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.key ??= await this.arkiv.findLocker(this.lockerId);
      if (!this.key) {
        this.key = await this.arkiv.createLocker(this.lockerId, lockReachable);
      } else {
        if (this.published !== lockReachable) await this.arkiv.patchLocker(this.key, lockReachable);
        await this.arkiv.extendLocker(this.key);
      }
      this.published = lockReachable;
    } catch (error) {
      // The entity may have expired, so look it up or recreate it on the next beat.
      this.key = null;
      this.published = null;
      console.warn(`[arkiv] status update failed: ${errorText(error)}`);
    } finally {
      this.busy = false;
    }
  }

  /** Throws on failure, so the publisher retries it. */
  decisionStored(pointer: DecisionPointer): Promise<void> {
    return this.arkiv.createDecision(pointer);
  }

  /** Doesn't wait for the block, so the door never waits on this write. */
  attempt(attempt: AttemptEntity): void {
    this.arkiv.createAttempt(attempt).catch((error) => {
      console.warn(`[arkiv] attempt not published: ${errorText(error)}`);
    });
  }
}
