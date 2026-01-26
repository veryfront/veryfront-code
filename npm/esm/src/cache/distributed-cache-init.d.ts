/**
 * Distributed Cache Initialization
 *
 * Initializes all distributed caches for cross-pod cache sharing.
 * This reduces memory pressure on individual pods by offloading
 * cached data to a shared backend (API or Redis).
 *
 * Backend selection priority:
 * - API (production): Uses veryfront-api for centralized cache
 * - Redis (local dev/open source): Direct Redis access
 * - Memory (fallback): In-memory cache
 *
 * Call this at server startup.
 */
export interface DistributedCacheStatus {
    backend: "api" | "redis" | "memory";
    transformCache: boolean;
    ssrModuleCache: boolean;
    fileCache: boolean;
    projectCSSCache: boolean;
}
/**
 * Initialize all distributed caches.
 *
 * This function is idempotent and safe to call multiple times.
 * Each cache will only initialize once.
 *
 * @returns Status object indicating which caches were enabled
 */
export declare function initializeDistributedCaches(): Promise<DistributedCacheStatus>;
//# sourceMappingURL=distributed-cache-init.d.ts.map