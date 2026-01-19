/**
 * Parallel Execution Utilities
 *
 * Provides utilities for parallel execution with concurrency control.
 * Uses a semaphore to limit the number of concurrent operations.
 *
 * @module core/utils/parallel
 */

import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";

/** Default max concurrent operations */
const DEFAULT_CONCURRENCY = 10;

/** Global semaphore for API calls - shared across all parallel operations */
const apiSemaphore = new Semaphore(DEFAULT_CONCURRENCY);

/**
 * Map over items in parallel with concurrency control.
 *
 * Like Promise.all(items.map(fn)) but limits concurrent executions
 * to prevent overwhelming the API or exhausting resources.
 *
 * @param items - Array of items to process
 * @param fn - Async function to apply to each item
 * @param options - Configuration options
 * @returns Promise resolving to array of results in same order as input
 *
 * @example
 * ```ts
 * // Process up to 5 files concurrently
 * const contents = await parallelMap(
 *   filePaths,
 *   path => fs.readFile(path),
 *   { concurrency: 5 }
 * );
 * ```
 */
export async function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options: { concurrency?: number; semaphore?: Semaphore } = {},
): Promise<R[]> {
  if (items.length === 0) return [];

  const semaphore = options.semaphore ?? apiSemaphore;
  const results: R[] = new Array(items.length);

  await Promise.all(
    items.map(async (item, index) => {
      await semaphore.acquire();
      try {
        results[index] = await fn(item, index);
      } finally {
        semaphore.release();
      }
    }),
  );

  return results;
}

/**
 * Execute async functions in parallel with concurrency control.
 *
 * Like Promise.all but limits concurrent executions.
 *
 * @param fns - Array of async functions to execute
 * @param options - Configuration options
 * @returns Promise resolving to array of results
 *
 * @example
 * ```ts
 * const [user, posts, comments] = await parallelAll([
 *   () => fetchUser(id),
 *   () => fetchPosts(id),
 *   () => fetchComments(id),
 * ]);
 * ```
 */
export function parallelAll<T extends readonly (() => Promise<unknown>)[]>(
  fns: T,
  options: { concurrency?: number; semaphore?: Semaphore } = {},
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  return parallelMap(
    [...fns] as (() => Promise<unknown>)[],
    (fn) => fn(),
    options,
  ) as Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>;
}

/**
 * Find the first item that matches a predicate, checking in parallel with concurrency control.
 *
 * Returns as soon as a match is found, cancelling remaining checks.
 *
 * @param items - Array of items to check
 * @param predicate - Async predicate function
 * @param options - Configuration options
 * @returns Promise resolving to first matching item or undefined
 *
 * @example
 * ```ts
 * const existingFile = await parallelFind(
 *   possiblePaths,
 *   async path => await fs.exists(path),
 * );
 * ```
 */
export async function parallelFind<T>(
  items: T[],
  predicate: (item: T, index: number) => Promise<boolean>,
  options: { concurrency?: number; semaphore?: Semaphore } = {},
): Promise<T | undefined> {
  if (items.length === 0) return undefined;

  const semaphore = options.semaphore ?? apiSemaphore;
  let found: T | undefined;
  let foundIndex = Infinity;

  await Promise.all(
    items.map(async (item, index) => {
      // Skip if we already found an earlier match
      if (index >= foundIndex) return;

      await semaphore.acquire();
      try {
        // Check again after acquiring permit
        if (index >= foundIndex) return;

        const matches = await predicate(item, index);
        if (matches && index < foundIndex) {
          found = item;
          foundIndex = index;
        }
      } finally {
        semaphore.release();
      }
    }),
  );

  return found;
}

/**
 * Filter items in parallel with concurrency control.
 *
 * @param items - Array of items to filter
 * @param predicate - Async predicate function
 * @param options - Configuration options
 * @returns Promise resolving to filtered array (maintains order)
 */
export async function parallelFilter<T>(
  items: T[],
  predicate: (item: T, index: number) => Promise<boolean>,
  options: { concurrency?: number; semaphore?: Semaphore } = {},
): Promise<T[]> {
  const results = await parallelMap(
    items,
    async (item, index) => ({ item, keep: await predicate(item, index) }),
    options,
  );
  return results.filter((r) => r.keep).map((r) => r.item);
}

/**
 * Create a new semaphore for custom concurrency control.
 *
 * @param permits - Maximum concurrent operations
 * @returns New Semaphore instance
 */
export function createSemaphore(permits: number): Semaphore {
  return new Semaphore(permits);
}

/**
 * Get the shared API semaphore for coordinating across modules.
 */
export function getApiSemaphore(): Semaphore {
  return apiSemaphore;
}
