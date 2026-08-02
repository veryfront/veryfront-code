import { MAX_TIMER_DELAY_MS } from "./timer.ts";
import { createAbortError } from "./abort.ts";

const DEFAULT_ACQUIRE_TIMEOUT_MS = 100;
export const DEFAULT_PERMIT_SEMAPHORE_MAX_QUEUE_SIZE = 10_000;

export interface PermitSemaphoreOptions {
  /** Maximum number of queued acquirers. */
  maxQueueSize?: number;
}

interface PermitWaiter {
  resolve: (acquired: boolean) => void;
  reject: (reason?: unknown) => void;
  settled: boolean;
  timeoutId?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function requireCapacity(value: number, optionName: string): number {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new RangeError(
    `${optionName} must be a non-negative safe integer`,
  );
}

function requireAcquireTimeout(timeoutMs: number): number {
  if (timeoutMs === Number.POSITIVE_INFINITY) return timeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Semaphore timeoutMs must be an integer between 0 and ${MAX_TIMER_DELAY_MS}, or Infinity`,
    );
  }
  return timeoutMs;
}

/**
 * FIFO semaphore for callers that acquire and release permits explicitly.
 *
 * A zero-permit semaphore is supported for admission tests and externally
 * released gates. Constructor and timeout inputs are validated so runtimes
 * cannot silently clamp invalid timers into hot loops.
 */
export class PermitSemaphore {
  private permits: number;
  private readonly maxPermits: number;
  private readonly maxQueueSize: number;
  private readonly waitQueue: PermitWaiter[] = [];

  constructor(permits: number, options: PermitSemaphoreOptions = {}) {
    this.maxPermits = requireCapacity(permits, "Semaphore permits");
    this.permits = this.maxPermits;
    this.maxQueueSize = requireCapacity(
      options.maxQueueSize ?? DEFAULT_PERMIT_SEMAPHORE_MAX_QUEUE_SIZE,
      "Semaphore maxQueueSize",
    );
  }

  async tryAcquire(
    timeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS,
    options: { signal?: AbortSignal } = {},
  ): Promise<boolean> {
    const normalizedTimeoutMs = requireAcquireTimeout(timeoutMs);
    const { signal } = options;
    if (signal?.aborted) {
      throw createAbortError(signal.reason);
    }

    if (this.permits > 0) {
      this.permits--;
      return true;
    }
    if (normalizedTimeoutMs === 0 || this.waitQueue.length >= this.maxQueueSize) {
      return false;
    }

    return await new Promise<boolean>((resolve, reject) => {
      const waiter: PermitWaiter = {
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
        reject(createAbortError(signal?.reason));
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal?.aborted) {
        waiter.onAbort();
        return;
      }

      if (normalizedTimeoutMs !== Number.POSITIVE_INFINITY) {
        waiter.timeoutId = setTimeout(() => {
          if (waiter.settled) return;
          waiter.settled = true;
          removeWaiter();
          cleanup();
          resolve(false);
        }, normalizedTimeoutMs);
      }

      this.waitQueue.push(waiter);
    });
  }

  release(): void {
    let next: PermitWaiter | undefined;
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

    // Preserve the established explicit-permit contract: callers own balanced
    // release discipline, and a release without a waiter creates a permit.
    this.permits++;
  }

  get available(): number {
    return this.permits;
  }

  get waiting(): number {
    return this.waitQueue.length;
  }

  get capacity(): number {
    return this.maxPermits;
  }

  get queueCapacity(): number {
    return this.maxQueueSize;
  }
}
