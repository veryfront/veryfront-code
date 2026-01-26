/**
 * Pod-Level Module Cache Singleton
 *
 * Provides shared module caches that persist across all RenderPipeline instances
 * within a pod. This dramatically improves cache hit rates for unchanged modules
 * compared to per-request caches.
 *
 * Features:
 * - LRU eviction to bound memory usage
 * - TTL-based expiration to pick up source changes
 * - Automatic registration with cache registry for debugging
 * - Project-scoped invalidation support
 *
 * @module cache/module-cache
 */
import { LRUCache } from "../utils/lru-wrapper.js";
/**
 * Cache statistics for monitoring.
 */
interface ModuleCacheStats {
    moduleCache: {
        size: number;
        maxEntries: number;
        ttlMs: number;
    };
    esmCache: {
        size: number;
        maxEntries: number;
        ttlMs: number;
    };
}
/**
 * Get or create the pod-level module cache.
 *
 * The cache is created lazily on first access and persists for the pod's lifetime.
 * Uses LRU eviction and TTL-based expiration.
 */
export declare function getModuleCache(): LRUCache<string, string>;
/**
 * Get or create the pod-level ESM cache.
 *
 * Used for caching ESM resolution results (specifier → URL mappings).
 */
export declare function getEsmCache(): LRUCache<string, string>;
/**
 * Create a Map-compatible interface for the module cache.
 *
 * This provides backward compatibility with code expecting Map<string, string>.
 * The underlying storage is the pod-level LRU cache singleton.
 */
export declare function createModuleCache(): Map<string, string>;
/**
 * Create a Map-compatible interface for the ESM cache.
 *
 * This provides backward compatibility with code expecting Map<string, string>.
 */
export declare function createEsmCache(): Map<string, string>;
/**
 * Get statistics about the module caches.
 */
export declare function getModuleCacheStats(): ModuleCacheStats;
/**
 * Clear all module caches.
 *
 * Used for invalidation when project content changes.
 */
export declare function clearModuleCaches(): void;
/**
 * Clear module cache entries for a specific project.
 *
 * @param projectId - The project ID to clear entries for
 * @returns Number of entries cleared
 */
export declare function clearModuleCacheForProject(projectId: string): number;
/**
 * Destroy the module caches and cleanup resources.
 *
 * Should be called on server shutdown.
 */
export declare function destroyModuleCaches(): void;
export {};
//# sourceMappingURL=module-cache.d.ts.map