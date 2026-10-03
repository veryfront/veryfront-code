import { unrefTimer } from "#veryfront/platform/compat/process.ts";

type Refresh = (signal: AbortSignal) => Promise<void>;

/** Bound background work independently of foreground metadata admission. */
export class RoutingRefreshScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Map<string, Refresh>();
  private running = new Map<string, AbortController>();
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
