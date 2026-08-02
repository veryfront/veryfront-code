import { MAX_BATCH_SIZE } from "#veryfront/utils/constants/limits.ts";

/**
 * Enforce the cache subsystem's shared per-operation batch bound.
 *
 * Request-level batching may split larger workloads into several operations,
 * but no backend or gateway may receive an unbounded array directly.
 */
export function assertCacheBatchSize(
  items: readonly unknown[],
  operation: string,
): void {
  if (items.length > MAX_BATCH_SIZE) {
    throw new RangeError(
      `${operation} may contain at most ${MAX_BATCH_SIZE} items`,
    );
  }
}
