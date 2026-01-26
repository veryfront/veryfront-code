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
/**
 * Mark a cache prefix as being invalidated.
 * Called when persistent cache deletion starts.
 */
export declare function addPendingInvalidation(prefix: string): void;
/**
 * Remove a cache prefix from pending invalidations.
 * Called when persistent cache deletion completes.
 */
export declare function removePendingInvalidation(prefix: string): void;
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
export declare function isPrefixBeingInvalidated(prefix: string): boolean;
/**
 * Get the count of pending invalidations.
 * Useful for observability and debugging.
 */
export declare function getPendingInvalidationsCount(): number;
/**
 * Get detailed state for debugging/troubleshooting.
 * Returns all pending invalidations with their ages.
 */
export declare function getInvalidationDebugState(): {
    pendingCount: number;
    totalBlockedReads: number;
    entries: Array<{
        prefix: string;
        ageMs: number;
        startedAt: number;
    }>;
};
/**
 * Clear all pending invalidations.
 * Only for testing purposes.
 */
export declare function clearAllPendingInvalidations(): void;
//# sourceMappingURL=invalidation-state.d.ts.map