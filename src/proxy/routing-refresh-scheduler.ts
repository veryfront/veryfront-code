import { unrefTimer } from "#veryfront/platform/compat/process.ts";

/**
 * Delay before an idle routing refresh. Refreshes are spread across replicas
 * over a window of 10% of the TTL that ends no later than 75% of it, and they
 * start early enough that the credential, access warm-up, and routing requests
 * can each take a full metadata timeout and still land before the entry
 * expires. When the TTL cannot fit that budget
 * the refresh starts at half the TTL rather than immediately, so a short TTL
 * never turns into a refresh loop.
 */
export function routingRefreshDelayRange(
  ttlMs: number,
  metadataTimeoutMs: number,
): { minMs: number; maxMs: number } {
  const latestStartMs = Math.max(Math.floor(ttlMs * 0.5), ttlMs - 3 * metadataTimeoutMs);
  const maxMs = Math.max(1, Math.min(Math.floor(ttlMs * 0.75), latestStartMs));
  const minMs = Math.max(1, maxMs - Math.floor(ttlMs * 0.1));
  return { minMs, maxMs };
}

type Refresh = (signal: AbortSignal) => Promise<void>;

/** Bound background work independently of foreground metadata admission. */
export class RoutingRefreshScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pending = new Map<string, Refresh>();
  private readonly running = new Map<string, AbortController>();
  private closed = false;

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxPending = 64,
  ) {}

  schedule(key: string, delayMs: number, refresh: Refresh): void {
    this.cancel(key);
    if (this.closed || this.maxConcurrent <= 0) return;
    const timer = setTimeout(() => {
      this.timers.delete(key);
      if (this.closed || this.pending.size >= this.maxPending) return;
      this.pending.set(key, refresh);
      this.drain();
    }, delayMs);
    this.timers.set(key, timer);
    unrefTimer(timer);
  }

  cancel(key: string): void {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.pending.delete(key);
    this.running.get(key)?.abort();
  }

  close(): void {
    this.closed = true;
    for (const key of this.timers.keys()) this.cancel(key);
    this.pending.clear();
    for (const controller of this.running.values()) controller.abort();
  }

  private drain(): void {
    while (!this.closed && this.running.size < this.maxConcurrent && this.pending.size > 0) {
      const [key, refresh] = this.pending.entries().next().value!;
      this.pending.delete(key);
      const controller = new AbortController();
      this.running.set(key, controller);
      void refresh(controller.signal).catch(() => {}).finally(() => {
        if (this.running.get(key) === controller) this.running.delete(key);
        this.drain();
      });
    }
  }
}
