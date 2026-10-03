/** Positive local settlement evidence, kept separately from cancellation signals. */
export class RunStopRegistry {
  private readonly runs = new Map<string, Set<() => void>>();
  private readonly stopped = new Set<string>();
  private readonly cancelled = new Map<string, number>();

  private prune(): void {
    const now = Date.now();
    for (const [runId, expiresAt] of this.cancelled) {
      if (expiresAt <= now) {
        this.cancelled.delete(runId);
        this.stopped.delete(runId);
      }
    }
  }

  register(runId: string, abort: () => void): () => void {
    this.prune();
    if (this.cancelled.has(runId)) throw new Error("Run cancelled");
    this.stopped.delete(runId);
    let executions = this.runs.get(runId);
    if (!executions) this.runs.set(runId, executions = new Set());
    executions.add(abort);
    let settled = false;
    return () => {
      if (settled) return;
      settled = true;
      executions.delete(abort);
      if (executions.size > 0) return;
      this.runs.delete(runId);
      this.stopped.add(runId);
      // Evict only settlement receipts; active executions always remain tracked.
      if (this.stopped.size > 10_000) this.stopped.delete(this.stopped.values().next().value!);
    };
  }

  requestStop(runId: string): { accepted: boolean; stopped: boolean } {
    this.prune();
    if (!this.cancelled.has(runId) && this.cancelled.size >= 10_000) {
      throw new Error("Cancellation registry capacity reached");
    }
    // Beyond the maximum lifetime of a signed dispatch credential. Refuse delayed starts.
    this.cancelled.set(runId, Date.now() + 24 * 60 * 60 * 1_000);
    const executions = this.runs.get(runId);
    if (executions) {
      for (const abort of executions) abort();
      return { accepted: true, stopped: false };
    }
    const stopped = this.stopped.has(runId);
    return { accepted: stopped, stopped };
  }
}
