/*******************************
 * Parallel Execution Utilities
 *
 * Provides utilities for parallel execution with concurrency control.
 * Uses a semaphore to limit the number of concurrent operations.
 *
 * @module core/utils/parallel
 *******************************/

import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const DEFAULT_CONCURRENCY = 20;
const ACQUIRE_TIMEOUT_MS = 30_000;

// No maxQueueSize — parallelMap schedules all items via Promise.all,
// so a queue cap would reject items in large batches instead of letting
// them progress under the concurrency limit with timeout-based backpressure.
const apiSemaphore = new Semaphore(DEFAULT_CONCURRENCY);

type ParallelOptions = {
  concurrency?: number;
  semaphore?: Semaphore;
  timeoutMs?: number;
};

async function acquireOrThrow(
  semaphore: Semaphore,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const acquired = await semaphore.tryAcquire(timeoutMs);
  if (acquired) return;

  throw new Error(
    `${label}: timed out waiting for semaphore after ${timeoutMs}ms (available: ${semaphore.available}, waiting: ${semaphore.waiting})`,
  );
}

export function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options: ParallelOptions = {},
): Promise<R[]> {
  return withSpan(
    "utils.parallelMap",
    async () => {
      if (items.length === 0) return [];

      const semaphore = options.semaphore ?? apiSemaphore;
      const timeoutMs = options.timeoutMs ?? ACQUIRE_TIMEOUT_MS;
      const results: R[] = new Array(items.length);

      await Promise.all(
        items.map(async (item, index) => {
          await acquireOrThrow(semaphore, timeoutMs, "parallelMap");
          try {
            results[index] = await fn(item, index);
          } finally {
            semaphore.release();
          }
        }),
      );

      return results;
    },
    {
      "parallel.itemCount": items.length,
      "parallel.timeoutMs": options.timeoutMs ?? ACQUIRE_TIMEOUT_MS,
    },
  );
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

export function parallelFind<T>(
  items: T[],
  predicate: (item: T, index: number) => Promise<boolean>,
  options: ParallelOptions = {},
): Promise<T | undefined> {
  return withSpan(
    "utils.parallelFind",
    async () => {
      if (items.length === 0) return undefined;

      const semaphore = options.semaphore ?? apiSemaphore;
      const timeoutMs = options.timeoutMs ?? ACQUIRE_TIMEOUT_MS;
      let found: T | undefined;
      let foundIndex = Infinity;

      await Promise.all(
        items.map(async (item, index) => {
          if (index >= foundIndex) return;

          await acquireOrThrow(semaphore, timeoutMs, "parallelFind");
          try {
            if (index >= foundIndex) return;

            const matches = await predicate(item, index);
            if (!matches || index >= foundIndex) return;

            found = item;
            foundIndex = index;
          } finally {
            semaphore.release();
          }
        }),
      );

      return found;
    },
    { "parallel.itemCount": items.length },
  );
}

export function parallelFilter<T>(
  items: T[],
  predicate: (item: T, index: number) => Promise<boolean>,
  options: ParallelOptions = {},
): Promise<T[]> {
  return withSpan(
    "utils.parallelFilter",
    async () => {
      const results = await parallelMap(
        items,
        async (item, index) => ({ item, keep: await predicate(item, index) }),
        options,
      );

      return results.filter((r) => r.keep).map((r) => r.item);
    },
    { "parallel.itemCount": items.length },
  );
}

export function createSemaphore(permits: number): Semaphore {
  return new Semaphore(permits);
}

export function getApiSemaphore(): Semaphore {
  return apiSemaphore;
}
