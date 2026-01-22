/**
 * Singleflight: Request Deduplication for Concurrent Operations
 *
 * Ensures that for a given key, only one operation runs at a time.
 * Concurrent callers for the same key wait for the single in-flight operation
 * and receive its result. This prevents race conditions in cache writes
 * and duplicate work for identical requests.
 *
 * Named after Go's singleflight package which provides the same functionality.
 *
 * @example
 * ```ts
 * const flight = new Singleflight<string>();
 *
 * // Multiple concurrent calls for the same key will share one operation
 * const results = await Promise.all([
 *   flight.do("key1", () => expensiveOperation()),
 *   flight.do("key1", () => expensiveOperation()), // Shares result with above
 *   flight.do("key2", () => otherOperation()),     // Runs independently
 * ]);
 * ```
 *
 * @module utils/singleflight
 */

/**
 * Singleflight ensures only one execution for a given key at a time.
 * Concurrent callers share the result of the single in-flight operation.
 */
export class Singleflight<T> {
  private inflight = new Map<string, Promise<T>>();

  /**
   * Execute the operation for the given key.
   * If an operation is already in flight for this key, return its promise.
   * Otherwise, start the operation and share its result with any concurrent callers.
   *
   * @param key - Unique key to deduplicate on (e.g., cache path, URL)
   * @param operation - The async operation to execute
   * @returns Promise that resolves to the operation result
   */
  async do(key: string, operation: () => Promise<T>): Promise<T> {
    // Check if there's already an in-flight operation for this key
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    // Create the operation promise and store it BEFORE starting execution
    // This is critical - we must store the promise synchronously to prevent races
    const promise = operation();
    this.inflight.set(key, promise);

    try {
      return await promise;
    } finally {
      // Clean up after completion (success or failure)
      this.inflight.delete(key);
    }
  }

  /**
   * Check if an operation is currently in flight for the given key.
   */
  has(key: string): boolean {
    return this.inflight.has(key);
  }

  /**
   * Get the number of currently in-flight operations.
   */
  get size(): number {
    return this.inflight.size;
  }
}

/**
 * Global singleflight instances for common use cases.
 * Using separate instances prevents key collisions between different subsystems.
 */

/** Singleflight for HTTP module caching */
export const httpCacheFlight = new Singleflight<string>();

/** Singleflight for MDX module compilation */
export const mdxCompileFlight = new Singleflight<string>();

/** Singleflight for file write operations */
export const fileWriteFlight = new Singleflight<void>();
