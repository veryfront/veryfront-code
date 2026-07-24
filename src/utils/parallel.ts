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
import { TIMEOUT_ERROR } from "#veryfront/errors/error-registry.ts";
import { MAX_TIMER_DELAY_MS } from "./constants/limits.ts";

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

  throw TIMEOUT_ERROR.create({
    detail:
      `${label}: timed out waiting for semaphore after ${timeoutMs}ms (available: ${semaphore.available}, waiting: ${semaphore.waiting})`,
  });
}

/** Run parallel map. */
export function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options: ParallelOptions = {},
): Promise<R[]> {
  return withSpan(
    "utils.parallelMap",
    async () => {
      if (
        options.semaphore === undefined &&
        options.concurrency !== undefined &&
        (!Number.isInteger(options.concurrency) || options.concurrency <= 0)
      ) {
        throw new RangeError("parallelMap concurrency must be a positive integer");
      }

      const timeoutMs = options.timeoutMs ?? ACQUIRE_TIMEOUT_MS;
      if (
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 0 ||
        timeoutMs > MAX_TIMER_DELAY_MS
      ) {
        throw new RangeError(
          `parallelMap timeoutMs must be an integer between 0 and ${MAX_TIMER_DELAY_MS}`,
        );
      }
      if (items.length === 0) return [];

      const semaphore = options.semaphore ??
        (options.concurrency === undefined ? apiSemaphore : new Semaphore(options.concurrency));
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
