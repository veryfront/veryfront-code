/** Default timeout for acquiring a semaphore permit (ms) */
const DEFAULT_ACQUIRE_TIMEOUT_MS = 100;

interface SemaphoreWaiter {
  resolve: (acquired: boolean) => void;
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
    const { signal } = options;
    if (signal?.aborted) {
      return Promise.reject(
        signal.reason ?? new DOMException("The operation was aborted", "AbortError"),
      );
    }

    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve(true);
    }

    if (timeoutMs <= 0) {
      return Promise.resolve(false);
    }

    if (this.waitQueue.length >= this.maxQueueSize) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve, reject) => {
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

      if (Number.isFinite(timeoutMs)) {
        waiter.timeoutId = setTimeout(() => {
          if (waiter.settled) return;
          waiter.settled = true;
          removeWaiter();
          cleanup();
          resolve(false);
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
      next.resolve(true);
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
