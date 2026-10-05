import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";

// Captured so project code that later replaces the clock cannot steer tombstone expiry.
const now = Date.now;

export type RunStopSettlement = "stopped" | "abandoned";

/** Positive local settlement evidence, kept separately from cancellation signals. */
export class RunStopRegistry {
  // Control-plane state: private collections use captured operations and iterator advancement,
  // so prototype mutations by project code in this process cannot hide or skip an execution.
  private readonly runs = createPrivateMap<string, Set<() => void>>();
  private readonly stopped = createPrivateSet<string>();
  /** Runs where an earlier execution settled positively while others were still registered. */
  private readonly settledWhileShared = createPrivateSet<string>();
  private readonly cancelled = createPrivateMap<string, number>();

  /** Tombstones are kept in expiry order, so pruning stops at the first live one. */
  private prune(): void {
    const current = now();
    for (const runId of this.cancelled.keys()) {
      if (this.cancelled.get(runId)! > current) return;
      this.cancelled.delete(runId);
      this.stopped.delete(runId);
    }
  }

  private capacityUsed(): number {
    let count = this.cancelled.size;
    for (const runId of this.runs.keys()) if (!this.cancelled.has(runId)) count++;
    return count;
  }

  /**
   * Admit a local execution. The returned callback retires it: `"stopped"` records positive
   * settlement evidence, `"abandoned"` drops a registration that never owned the execution.
   */
  register(runId: string, abort: () => void): (outcome?: RunStopSettlement) => void {
    this.prune();
    if (this.cancelled.has(runId)) throw new Error("Run cancelled");
    let executions = this.runs.get(runId);
    if (!executions) {
      // Reserve its future tombstone before admitting a producer, so stop delivery cannot fail at capacity.
      if (this.capacityUsed() >= 10_000) throw new Error("Cancellation registry capacity reached");
      this.runs.set(runId, executions = createPrivateSet());
      this.settledWhileShared.delete(runId);
    }
    this.stopped.delete(runId);
    executions.add(abort);
    let settled = false;
    return (outcome = "stopped") => {
      if (settled) return;
      settled = true;
      executions.delete(abort);
      if (executions.size > 0) {
        if (outcome === "stopped") this.settledWhileShared.add(runId);
        return;
      }
      this.runs.delete(runId);
      // An abandoned last registration must not erase an earlier execution's positive evidence.
      const settledEarlier = this.settledWhileShared.delete(runId);
      if (outcome === "abandoned" && !settledEarlier) return;
      this.stopped.add(runId);
      // Evict only settlement receipts; active executions always remain tracked.
      if (this.stopped.size > 10_000) this.stopped.delete(this.stopped.values().next().value!);
    };
  }

  requestStop(runId: string): { accepted: boolean; stopped: boolean } {
    this.prune();
    if (!this.cancelled.has(runId) && !this.runs.has(runId) && this.capacityUsed() >= 10_000) {
      throw new Error("Cancellation registry capacity reached");
    }
    // Beyond the maximum lifetime of a signed dispatch credential. Refuse delayed starts.
    this.cancelled.delete(runId);
    this.cancelled.set(runId, now() + 24 * 60 * 60 * 1_000);
    const executions = this.runs.get(runId);
    if (executions) {
      for (const abort of executions) abort();
      return { accepted: true, stopped: false };
    }
    const stopped = this.stopped.has(runId);
    return { accepted: stopped, stopped };
  }
}
