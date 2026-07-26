/*******************************
 * Parallel Execution Utilities
 *
 * Provides utilities for parallel execution with concurrency control.
 * Uses a semaphore to limit the number of concurrent operations.
 *
 * @module utils/parallel
 *******************************/

import { TIMEOUT_ERROR } from "#veryfront/errors/error-registry.ts";
import { MAX_TIMER_DELAY_MS } from "./constants/limits.ts";
import { PermitSemaphore } from "./permit-semaphore.ts";

const DEFAULT_CONCURRENCY = 20;
const ACQUIRE_TIMEOUT_MS = 30_000;
const MAX_CONCURRENCY = 10_000;
const MAX_GLOBAL_WAITERS = 1_000;

const apiSemaphore = new PermitSemaphore(DEFAULT_CONCURRENCY, {
  maxQueueSize: MAX_GLOBAL_WAITERS,
});

export interface ParallelSemaphore {
  tryAcquire(timeoutMs?: number): Promise<boolean>;
  release(): void;
  readonly available: number;
  readonly waiting: number;
  readonly capacity?: number;
}

export type ParallelOptions = {
  concurrency?: number;
  semaphore?: ParallelSemaphore;
  timeoutMs?: number;
};

async function acquireOrThrow(
  semaphore: ParallelSemaphore,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const acquired = await semaphore.tryAcquire(timeoutMs);
  if (acquired) return;

  throw TIMEOUT_ERROR.create({
    detail:
      `${label}: timed out waiting for semaphore after ${timeoutMs}ms (available: ${semaphore.available}, waiting: ${semaphore.waiting})`,
  });
}

function requireConcurrency(concurrency: number | undefined): number | undefined {
  if (concurrency === undefined) return undefined;
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency <= 0 ||
    concurrency > MAX_CONCURRENCY
  ) {
    throw new RangeError(
      `parallelMap concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`,
    );
  }
  return concurrency;
}

function getWorkerCount(
  itemCount: number,
  concurrency: number | undefined,
  semaphore: ParallelSemaphore,
): number {
  const semaphoreCapacity = semaphore.capacity;
  const requested = concurrency ??
    (
      Number.isSafeInteger(semaphoreCapacity) &&
        semaphoreCapacity !== undefined &&
        semaphoreCapacity > 0
        ? semaphoreCapacity
        : DEFAULT_CONCURRENCY
    );
  return Math.min(itemCount, requested, MAX_CONCURRENCY);
}

/** Run parallel map. */
export async function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options: ParallelOptions = {},
): Promise<R[]> {
  const concurrency = requireConcurrency(options.concurrency);
  const timeoutMs = options.timeoutMs ?? ACQUIRE_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `parallelMap timeoutMs must be an integer between 0 and ${MAX_TIMER_DELAY_MS}`,
    );
  }
  if (items.length === 0) return [];

  const semaphore = options.semaphore ??
    (concurrency === undefined ? apiSemaphore : new PermitSemaphore(concurrency));
  const workerCount = getWorkerCount(items.length, concurrency, semaphore);
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (!failed) {
      const index = nextIndex++;
      if (index >= items.length) return;

      try {
        await acquireOrThrow(semaphore, timeoutMs, "parallelMap");
        try {
          results[index] = await fn(items[index]!, index);
        } finally {
          semaphore.release();
        }
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
        throw error;
      }
    }
  }

  await Promise.allSettled(
    Array.from({ length: workerCount }, () => worker()),
  );
  if (failed) throw firstError;
  return results;
}

export function parallelAll<T extends readonly (() => Promise<unknown>)[]>(
  fns: T,
  options: ParallelOptions = {},
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  return parallelMap(
    [...fns] as (() => Promise<unknown>)[],
    (fn) => fn(),
    options,
  ) as Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>;
}
