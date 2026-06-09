/**
 * Shared batch-result assembly for cache reads.
 *
 * Cache backends and cache gateways often resolve a requested key list into a
 * `Map<string, string | null>` where each requested key is present and missing
 * values resolve to `null`. This helper centralizes that assembly so callers
 * only supply the resolver.
 *
 * @module cache/batch-results
 */

/**
 * Build a `Map` of batch results by resolving each key in order.
 *
 * The map preserves the requested keys' insertion order. `resolve` is invoked
 * once per key and must return the resolved value or `null`.
 *
 * @param keys Requested cache keys.
 * @param resolve Resolver mapping a key to its value (or `null`).
 */
export function buildBatchResults(
  keys: string[],
  resolve: (key: string) => string | null,
): Map<string, string | null> {
  const results = new Map<string, string | null>();
  for (const key of keys) {
    results.set(key, resolve(key));
  }
  return results;
}
