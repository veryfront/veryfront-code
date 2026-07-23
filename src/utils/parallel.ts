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
import { INVALID_ARGUMENT, TIMEOUT_ERROR } from "#veryfront/errors/error-registry/general.ts";

const DEFAULT_CONCURRENCY = 20;
const ACQUIRE_TIMEOUT_MS = 30_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const apiSemaphore = new Semaphore(DEFAULT_CONCURRENCY);

type ParallelOptions = {
  concurrency?: number;
  semaphore?: Semaphore;
  timeoutMs?: number;
};

interface ResolvedParallelOptions {
  concurrency: number;
  semaphore: Semaphore;
  timeoutMs: number;
}

function invalidParallelOption(message: string): Error {
  return INVALID_ARGUMENT.create({ message });
}

function resolveParallelOptions(options: ParallelOptions): ResolvedParallelOptions {
  if (options === null || typeof options !== "object") {
    throw invalidParallelOption("Parallel options must be an object");
  }

  let concurrency: unknown;
  let semaphore: unknown;
  let timeoutMs: unknown;
  try {
    concurrency = options.concurrency;
    semaphore = options.semaphore;
    timeoutMs = options.timeoutMs;
  } catch {
    throw invalidParallelOption("Parallel options are not readable");
  }

  const resolvedConcurrency = concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isSafeInteger(resolvedConcurrency) || (resolvedConcurrency as number) <= 0) {
    throw invalidParallelOption("Parallel concurrency must be a positive safe integer");
  }

  const resolvedTimeoutMs = timeoutMs ?? ACQUIRE_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(resolvedTimeoutMs) || (resolvedTimeoutMs as number) < 0 ||
    (resolvedTimeoutMs as number) > MAX_TIMER_DELAY_MS
  ) {
    throw invalidParallelOption(
      `Parallel timeoutMs must be a non-negative safe integer no greater than ${MAX_TIMER_DELAY_MS}`,
    );
  }

  if (semaphore !== undefined) {
    let validSemaphore = false;
    try {
      validSemaphore = semaphore instanceof Semaphore;
    } catch {
      throw invalidParallelOption("Parallel semaphore is not readable");
    }
    if (!validSemaphore) throw invalidParallelOption("Parallel semaphore must be a Semaphore");
  }

  return {
    concurrency: resolvedConcurrency as number,
    semaphore: semaphore as Semaphore | undefined ??
      (concurrency === undefined ? apiSemaphore : new Semaphore(resolvedConcurrency as number)),
    timeoutMs: resolvedTimeoutMs as number,
  };
}

function snapshotParallelItems<T>(items: readonly T[]): T[] {
  let isArray = false;
  try {
    isArray = Array.isArray(items);
  } catch {
    throw invalidParallelOption("Parallel items are not readable");
  }
  if (!isArray) throw invalidParallelOption("Parallel items must be an array");

  try {
    const length = items.length;
    const snapshot = new Array<T>(length);
    for (let index = 0; index < length; index++) {
      if (index in items) snapshot[index] = items[index]!;
    }
    return snapshot;
  } catch {
    throw invalidParallelOption("Parallel items are not readable");
  }
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

async function runParallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options: ResolvedParallelOptions,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let failed = false;

  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = nextIndex++;
      if (index >= items.length) return;
      if (!(index in items)) continue;

      let acquired = false;
      try {
        await acquireOrThrow(options.semaphore, options.timeoutMs, "parallelMap");
        acquired = true;
        if (failed) return;
        results[index] = await fn(items[index]!, index);
      } catch (error) {
        if (!failed) {
          failed = true;
          throw error;
        }
      } finally {
        if (acquired) options.semaphore.release();
      }
    }
  };

  const workerCount = Math.min(options.concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/** Run parallel map. */
export function parallelMap<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  options: ParallelOptions = {},
): Promise<R[]> {
  let resolvedOptions: ResolvedParallelOptions;
  let itemSnapshot: T[];
  try {
    resolvedOptions = resolveParallelOptions(options);
    itemSnapshot = snapshotParallelItems(items);
  } catch (error) {
    return Promise.reject(error);
  }

  return withSpan(
    "utils.parallelMap",
    () => runParallelMap(itemSnapshot, fn, resolvedOptions),
    {
      "parallel.itemCount": itemSnapshot.length,
      "parallel.concurrency": resolvedOptions.concurrency,
      "parallel.timeoutMs": resolvedOptions.timeoutMs,
    },
  );
}

export function parallelAll<T extends readonly (() => Promise<unknown>)[]>(
  fns: T,
  options: ParallelOptions = {},
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  return parallelMap(
    fns,
    (fn) => fn(),
    options,
  ) as Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>;
}
