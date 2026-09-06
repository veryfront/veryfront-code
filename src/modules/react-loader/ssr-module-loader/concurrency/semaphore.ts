import {
  primordialArrayIndexOf,
  primordialArrayPush,
  primordialArrayShift,
  primordialArraySplice,
} from "#veryfront/platform/compat/primordials/array.ts";
import {
  IntrinsicPromise,
  primordialPromiseReject,
  primordialPromiseResolve,
  primordialPromiseThen,
} from "#veryfront/platform/compat/primordials/promise.ts";

const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
const NumberIsFinite = Number.isFinite;

/** Default timeout for acquiring a semaphore permit (ms) */
const DEFAULT_ACQUIRE_TIMEOUT_MS = 100;

/** Result of an acquire attempt, with the queue depth it observed. */
export interface SemaphoreAcquireReport {
  acquired: boolean;
  /**
   * For a timed-out waiter, queue depth at the moment it settled, including
   * that waiter. Other reports count waiters that remain queued.
   * A timed-out waiter leaves the queue before its caller resumes, so reading
   * {@link Semaphore.waiting} afterwards understates the depth it observed.
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
    return primordialPromiseThen(
      this.tryAcquireWithReport(timeoutMs, options),
      (report) => report.acquired,
    );
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
      return primordialPromiseReject(
        signal.reason ?? new DOMException("The operation was aborted", "AbortError"),
      );
    }

    if (this.permits > 0) {
      this.permits--;
      return primordialPromiseResolve({ acquired: true, waiting: this.waitQueue.length });
    }

    if (timeoutMs <= 0) {
      return primordialPromiseResolve({ acquired: false, waiting: this.waitQueue.length });
    }

    if (this.waitQueue.length >= this.maxQueueSize) {
      return primordialPromiseResolve({ acquired: false, waiting: this.waitQueue.length });
    }

    return new IntrinsicPromise<SemaphoreAcquireReport>((resolve, reject) => {
      const waiter: SemaphoreWaiter = {
        resolve,
        reject,
        settled: false,
        signal,
      };

      const removeWaiter = (): void => {
        const index = primordialArrayIndexOf(this.waitQueue, waiter);
        if (index !== -1) primordialArraySplice(this.waitQueue, index, 1);
      };
      const cleanup = (): void => {
        if (waiter.timeoutId !== undefined) hostClearTimeout(waiter.timeoutId);
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

      if (NumberIsFinite(timeoutMs)) {
        waiter.timeoutId = hostSetTimeout(() => {
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

      primordialArrayPush(this.waitQueue, waiter);
    });
  }

  release(): void {
    let next: SemaphoreWaiter | undefined;
    while ((next = primordialArrayShift(this.waitQueue))) {
      if (next.settled) continue;
      next.settled = true;
      if (next.timeoutId !== undefined) hostClearTimeout(next.timeoutId);
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
