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
import { primordialPromiseAll } from "#veryfront/platform/compat/primordials/promise.ts";
import {
  primordialArrayMap,
  primordialArraySet,
} from "#veryfront/platform/compat/primordials/array.ts";

const IntrinsicArray = Array;
const NumberIsSafeInteger = Number.isSafeInteger;

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

function resolveParallelSemaphore(options: ParallelOptions): Semaphore {
  if (options.semaphore !== undefined) return options.semaphore;
  if (options.concurrency === undefined) return apiSemaphore;
  if (!NumberIsSafeInteger(options.concurrency) || options.concurrency < 1) {
    throw new RangeError("parallel concurrency must be a positive safe integer");
  }
  return new Semaphore(options.concurrency);
}

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
      if (items.length === 0) return [];

      const semaphore = resolveParallelSemaphore(options);
      const timeoutMs = options.timeoutMs ?? ACQUIRE_TIMEOUT_MS;
      const results: R[] = new IntrinsicArray(items.length);

      await primordialPromiseAll(
        primordialArrayMap(items, async (item, index) => {
          await acquireOrThrow(semaphore, timeoutMs, "parallelMap");
          try {
            primordialArraySet(results, index, await fn(item, index));
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
  const dense: Array<() => Promise<unknown>> = [];
  for (let index = 0; index < fns.length; index++) {
    primordialArraySet(dense, index, fns[index]!);
  }
  return parallelMap(
    dense,
    (fn) => fn(),
    options,
  ) as Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>;
}
