/**
 * Semaphore: Concurrency Limiter
 *
 * Limits concurrent operations to prevent resource exhaustion.
 *
 * @module utils/semaphore
 */

import { SEMAPHORE_TIMEOUT } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  primordialArrayIndexOf,
  primordialArrayPush,
  primordialArrayShift,
  primordialArraySplice,
} from "#veryfront/platform/compat/primordials/array.ts";
import {
  IntrinsicPromise,
  primordialPromiseResolve,
} from "#veryfront/platform/compat/primordials/promise.ts";

const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);

/**
 * Thrown when a semaphore acquire exceeds its configured timeout.
 *
 * Extends {@link VeryfrontError} so it carries registry slug/status/category
 * and RFC-9457 fields, while remaining `instanceof SemaphoreTimeoutError` for
 * existing catch sites.
 */
export class SemaphoreTimeoutError extends VeryfrontError {
  constructor(name: string, timeoutMs: number) {
    super(`Semaphore '${name}' acquire timeout after ${timeoutMs}ms`, {
      slug: SEMAPHORE_TIMEOUT.slug,
      category: SEMAPHORE_TIMEOUT.category,
      status: SEMAPHORE_TIMEOUT.status,
      title: SEMAPHORE_TIMEOUT.title,
      suggestion: SEMAPHORE_TIMEOUT.suggestion,
      context: { name, timeoutMs },
    });
    this.name = "SemaphoreTimeoutError";
  }
}

interface WaitingTask {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

export class Semaphore {
  private permits: number;
  private readonly maxPermits: number;
  private readonly waiting: WaitingTask[] = [];
  private readonly acquireTimeoutMs: number;
  private readonly semaphoreName: string;

  constructor(
    maxPermits: number,
    options: { acquireTimeoutMs?: number; name?: string } = {},
  ) {
    this.maxPermits = maxPermits;
    this.permits = maxPermits;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? 0;
    this.semaphoreName = options.name ?? "default";
  }

  /** Acquire permit, execute operation, release automatically */
  async acquire<T>(operation: () => Promise<T>): Promise<T> {
    await this.waitForPermit();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private waitForPermit(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return primordialPromiseResolve();
    }

    return new IntrinsicPromise<void>((resolve, reject) => {
      const task: WaitingTask = { resolve, reject };

      if (this.acquireTimeoutMs > 0) {
        task.timeoutId = hostSetTimeout(() => {
          const idx = primordialArrayIndexOf(this.waiting, task);
          if (idx !== -1) primordialArraySplice(this.waiting, idx, 1);
          reject(
            new SemaphoreTimeoutError(this.semaphoreName, this.acquireTimeoutMs),
          );
        }, this.acquireTimeoutMs);
      }

      primordialArrayPush(this.waiting, task);
    });
  }

  private release(): void {
    const next = primordialArrayShift(this.waiting);
    if (!next) {
      this.permits++;
      return;
    }

    if (next.timeoutId) hostClearTimeout(next.timeoutId);
    next.resolve();
  }

  get active(): number {
    return this.maxPermits - this.permits;
  }

  get waitingCount(): number {
    return this.waiting.length;
  }
}

const semaphores = new Map<string, Semaphore>();

export function getSemaphore(
  name: string,
  maxPermits: number,
  options?: { acquireTimeoutMs?: number },
): Semaphore {
  const existing = semaphores.get(name);
  if (existing) return existing;

  const sem = new Semaphore(maxPermits, { ...options, name });
  semaphores.set(name, sem);
  return sem;
}
