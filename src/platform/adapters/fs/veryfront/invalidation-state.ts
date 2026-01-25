/**
 * Global Invalidation State Module
 *
 * Maintains a global, module-level map of pending persistent cache invalidations.
 * This solves the race condition where a POKE arrives on an OLD adapter instance,
 * but the subsequent request is handled by a NEW adapter instance (with empty state).
 *
 * By using module-level state, all adapter instances share the same invalidation
 * tracking, ensuring requests wait for cache invalidation to complete regardless
 * of which adapter instance is handling them.
 *
 * Key observability points (search for these in logs):
 * - INVALIDATION_STARTED: A cache invalidation has begun
 * - INVALIDATION_COMPLETED: A cache invalidation finished
 * - CACHE_READ_BLOCKED: A cache read was blocked due to pending invalidation (PROOF OF FIX)
 * - INVALIDATION_STALE_CLEANUP: Stale invalidation entries were cleaned up
 */

import { logger } from "#veryfront/utils";

/** Maximum age for a pending invalidation before it's considered stale (5 minutes) */
const STALE_INVALIDATION_THRESHOLD_MS = 5 * 60 * 1000;

/** How often to run stale cleanup (30 seconds) */
const CLEANUP_INTERVAL_MS = 30 * 1000;

/** Last time we ran stale cleanup */
let lastCleanupTime = 0;

/** Counter for tracking blocked reads (proof metric) */
let totalBlockedReads = 0;

/** Map of cache key prefixes currently being invalidated → timestamp when started */
const pendingInvalidations = new Map<string, number>();

/**
 * Clean up stale invalidation entries that may have been orphaned.
 * This is a safety net - normally entries should be cleaned up by removePendingInvalidation.
 */
function cleanupStaleInvalidations(): void {
  const now = Date.now();

  // Rate limit cleanup
  if (now - lastCleanupTime < CLEANUP_INTERVAL_MS) {
    return;
  }
  lastCleanupTime = now;

  const staleEntries: Array<{ prefix: string; ageMs: number }> = [];

  for (const [prefix, startedAt] of pendingInvalidations.entries()) {
    const ageMs = now - startedAt;
    if (ageMs > STALE_INVALIDATION_THRESHOLD_MS) {
      staleEntries.push({ prefix, ageMs });
      pendingInvalidations.delete(prefix);
    }
  }

  if (staleEntries.length > 0) {
    logger.warn("[InvalidationState] INVALIDATION_STALE_CLEANUP - removed orphaned entries", {
      removedCount: staleEntries.length,
      entries: staleEntries,
      remainingCount: pendingInvalidations.size,
    });
  }
}

/**
 * Mark a cache prefix as being invalidated.
 * Called when persistent cache deletion starts.
 */
export function addPendingInvalidation(prefix: string): void {
  const startedAt = Date.now();
  pendingInvalidations.set(prefix, startedAt);

  logger.info("[InvalidationState] INVALIDATION_STARTED - cache prefix marked for invalidation", {
    prefix,
    startedAt,
    totalPending: pendingInvalidations.size,
  });
}

/**
 * Remove a cache prefix from pending invalidations.
 * Called when persistent cache deletion completes.
 */
export function removePendingInvalidation(prefix: string): void {
  const startedAt = pendingInvalidations.get(prefix);
  const durationMs = startedAt ? Date.now() - startedAt : null;

  pendingInvalidations.delete(prefix);

  logger.info("[InvalidationState] INVALIDATION_COMPLETED - cache prefix invalidation finished", {
    prefix,
    durationMs,
    totalPending: pendingInvalidations.size,
  });
}

/**
 * Check if a cache prefix is currently being invalidated.
 * Returns true if the prefix matches any pending invalidation (either direction).
 *
 * The bidirectional matching handles:
 * - prefix="file:env:project:prod:rel1:" matches pending="file:env:project:prod:rel1:/pages/index.tsx"
 * - prefix="file:env:project:prod:rel1:/pages/index.tsx" matches pending="file:env:project:prod:rel1:"
 *
 * IMPORTANT: When this returns true, it means the fix is working - a cache read
 * is being blocked to prevent stale content during deployment.
 */
export function isPrefixBeingInvalidated(prefix: string): boolean {
  // Opportunistic cleanup of stale entries
  cleanupStaleInvalidations();

  for (const [pendingPrefix, startedAt] of pendingInvalidations.entries()) {
    if (prefix.startsWith(pendingPrefix) || pendingPrefix.startsWith(prefix)) {
      const ageMs = Date.now() - startedAt;
      totalBlockedReads++;

      // This is the KEY log proving the fix works
      logger.info("[InvalidationState] CACHE_READ_BLOCKED - preventing stale cache read", {
        requestedPrefix: prefix,
        blockingPrefix: pendingPrefix,
        invalidationAgeMs: ageMs,
        totalBlockedReads,
        totalPending: pendingInvalidations.size,
      });

      return true;
    }
  }

  return false;
}

/**
 * Get the count of pending invalidations.
 * Useful for observability and debugging.
 */
export function getPendingInvalidationsCount(): number {
  return pendingInvalidations.size;
}

/**
 * Get detailed state for debugging/troubleshooting.
 * Returns all pending invalidations with their ages.
 */
export function getInvalidationDebugState(): {
  pendingCount: number;
  totalBlockedReads: number;
  entries: Array<{ prefix: string; ageMs: number; startedAt: number }>;
} {
  const now = Date.now();
  const entries = Array.from(pendingInvalidations.entries()).map(([prefix, startedAt]) => ({
    prefix,
    startedAt,
    ageMs: now - startedAt,
  }));

  return {
    pendingCount: pendingInvalidations.size,
    totalBlockedReads,
    entries,
  };
}

/**
 * Clear all pending invalidations.
 * Only for testing purposes.
 */
export function clearAllPendingInvalidations(): void {
  pendingInvalidations.clear();
  totalBlockedReads = 0;
}
