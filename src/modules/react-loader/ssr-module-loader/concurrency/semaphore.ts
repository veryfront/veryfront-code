/** Default timeout for acquiring a semaphore permit (ms) */
const DEFAULT_ACQUIRE_TIMEOUT_MS = 100;

/** Result of an acquire attempt, with the queue depth it observed. */
export interface SemaphoreAcquireReport {
  acquired: boolean;
  /**
   * Queue depth at the moment the attempt settled, counting the waiter itself.
   * A timed-out waiter leaves the queue before its caller resumes, so reading
   * {@link Semaphore.waiting} afterwards understates the real depth.
   */
  waiting: number;
}

interface SemaphoreWaiter {
  resolve: (report: SemaphoreAcquireReport) => void;
  reject: (reason?: unknown) => void;
  settled: boolean;
  timeoutId?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class Semaphore {
  private permits: number;
  private readonly maxQueueSize: number;
  private waitQueue: SemaphoreWaiter[] = [];

  constructor(permits: number, options?: { maxQueueSize?: number }) {
    this.permits = permits;
    this.maxQueueSize = options?.maxQueueSize ?? Infinity;
  }

  tryAcquire(
    timeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS,
    options: { signal?: AbortSignal } = {},
  ): Promise<boolean> {
    return this.tryAcquireWithReport(timeoutMs, options).then((report) => report.acquired);
  }

  /**
   * Acquire a permit and report the queue depth the attempt observed. Use this
   * instead of {@link tryAcquire} when a failure needs an accurate diagnostic.
   */
  tryAcquireWithReport(
    timeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS,
    options: { signal?: AbortSignal } = {},
  ): Promise<SemaphoreAcquireReport> {
    const { signal } = options;
    if (signal?.aborted) {
      return Promise.reject(
        signal.reason ?? new DOMException("The operation was aborted", "AbortError"),
      );
    }

    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve({ acquired: true, waiting: this.waitQueue.length });
    }

    if (timeoutMs <= 0) {
      return Promise.resolve({ acquired: false, waiting: this.waitQueue.length });
    }

    if (this.waitQueue.length >= this.maxQueueSize) {
      return Promise.resolve({ acquired: false, waiting: this.waitQueue.length });
    }

    return new Promise<SemaphoreAcquireReport>((resolve, reject) => {
      const waiter: SemaphoreWaiter = {
        resolve,
        reject,
        settled: false,
        signal,
      };

      const removeWaiter = (): void => {
        const index = this.waitQueue.indexOf(waiter);
        if (index !== -1) this.waitQueue.splice(index, 1);
      };
      const cleanup = (): void => {
        if (waiter.timeoutId !== undefined) clearTimeout(waiter.timeoutId);
        if (waiter.signal && waiter.onAbort) {
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        }
      };

      waiter.onAbort = () => {
        if (waiter.settled) return;
        waiter.settled = true;
        removeWaiter();
        cleanup();
        reject(
          signal?.reason ?? new DOMException("The operation was aborted", "AbortError"),
        );
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal?.aborted) {
        waiter.onAbort();
        return;
      }

      if (Number.isFinite(timeoutMs)) {
        waiter.timeoutId = setTimeout(() => {
          if (waiter.settled) return;
          waiter.settled = true;
          // Read the depth before this waiter leaves the queue, otherwise the
          // last waiter standing reports an empty queue it was still part of.
          const waiting = this.waitQueue.length;
          removeWaiter();
          cleanup();
          resolve({ acquired: false, waiting });
        }, timeoutMs);
      }

      this.waitQueue.push(waiter);
    });
  }

  release(): void {
    let next: SemaphoreWaiter | undefined;
    while ((next = this.waitQueue.shift())) {
      if (next.settled) continue;
      next.settled = true;
      if (next.timeoutId !== undefined) clearTimeout(next.timeoutId);
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener("abort", next.onAbort);
      }
      next.resolve({ acquired: true, waiting: this.waitQueue.length });
      return;
    }

    this.permits++;
  }

  get available(): number {
    return this.permits;
  }

  get waiting(): number {
    return this.waitQueue.length;
  }
}
