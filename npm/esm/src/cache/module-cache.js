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
import { rendererLogger as logger } from "../utils/index.js";
import { registerLRUCache } from "./registry.js";
import { ESM_CACHE_MAX_ENTRIES, ESM_CACHE_TTL_MS, MODULE_CACHE_MAX_ENTRIES, MODULE_CACHE_TTL_MS, } from "../utils/constants/cache.js";
/**
 * Pod-level module cache singleton.
 *
 * Maps module cache keys to transformed temp file paths.
 * Key format: `{projectId}:{filePath}`
 */
let moduleCache = null;
/**
 * Pod-level ESM cache singleton.
 *
 * Maps ESM specifiers to resolved URLs or file paths.
 * Key format varies by usage.
 */
let esmCache = null;
/**
 * Get or create the pod-level module cache.
 *
 * The cache is created lazily on first access and persists for the pod's lifetime.
 * Uses LRU eviction and TTL-based expiration.
 */
export function getModuleCache() {
    if (!moduleCache) {
        moduleCache = new LRUCache({
            maxEntries: MODULE_CACHE_MAX_ENTRIES,
            ttlMs: MODULE_CACHE_TTL_MS,
        });
        // Register with cache registry for debugging and invalidation
        registerLRUCache("pod-module-cache", moduleCache);
        logger.info("[ModuleCache] Pod-level module cache initialized", {
            maxEntries: MODULE_CACHE_MAX_ENTRIES,
            ttlMs: MODULE_CACHE_TTL_MS,
        });
    }
    return moduleCache;
}
/**
 * Get or create the pod-level ESM cache.
 *
 * Used for caching ESM resolution results (specifier → URL mappings).
 */
export function getEsmCache() {
    if (!esmCache) {
        esmCache = new LRUCache({
            maxEntries: ESM_CACHE_MAX_ENTRIES,
            ttlMs: ESM_CACHE_TTL_MS,
        });
        // Register with cache registry for debugging and invalidation
        registerLRUCache("pod-esm-cache", esmCache);
        logger.info("[ModuleCache] Pod-level ESM cache initialized", {
            maxEntries: ESM_CACHE_MAX_ENTRIES,
            ttlMs: ESM_CACHE_TTL_MS,
        });
    }
    return esmCache;
}
/**
 * Create a Map-compatible interface for the module cache.
 *
 * This provides backward compatibility with code expecting Map<string, string>.
 * The underlying storage is the pod-level LRU cache singleton.
 */
export function createModuleCache() {
    const cache = getModuleCache();
    return createMapInterface(cache);
}
/**
 * Create a Map-compatible interface for the ESM cache.
 *
 * This provides backward compatibility with code expecting Map<string, string>.
 */
export function createEsmCache() {
    const cache = getEsmCache();
    return createMapInterface(cache);
}
/**
 * Create a Map-compatible interface backed by an LRU cache.
 */
function createMapInterface(cache) {
    // Create a proxy that delegates to the LRU cache
    // This allows existing code expecting Map to work unchanged
    return {
        get(key) {
            return cache.get(key);
        },
        set(key, value) {
            cache.set(key, value);
            return this;
        },
        has(key) {
            return cache.has(key);
        },
        delete(key) {
            return cache.delete(key);
        },
        clear() {
            cache.clear();
        },
        get size() {
            return cache.size;
        },
        // Required Map methods that iterate - these work but may be expensive
        *keys() {
            yield* cache.keys();
        },
        *values() {
            for (const key of cache.keys()) {
                const value = cache.get(key);
                if (value !== undefined)
                    yield value;
            }
        },
        *entries() {
            for (const key of cache.keys()) {
                const value = cache.get(key);
                if (value !== undefined)
                    yield [key, value];
            }
        },
        forEach(callback) {
            for (const key of cache.keys()) {
                const value = cache.get(key);
                if (value !== undefined)
                    callback(value, key, this);
            }
        },
        [Symbol.iterator]() {
            return this.entries();
        },
        [Symbol.toStringTag]: "Map",
    };
}
/**
 * Get statistics about the module caches.
 */
export function getModuleCacheStats() {
    return {
        moduleCache: {
            size: moduleCache?.size ?? 0,
            maxEntries: MODULE_CACHE_MAX_ENTRIES,
            ttlMs: MODULE_CACHE_TTL_MS,
        },
        esmCache: {
            size: esmCache?.size ?? 0,
            maxEntries: ESM_CACHE_MAX_ENTRIES,
            ttlMs: ESM_CACHE_TTL_MS,
        },
    };
}
/**
 * Clear all module caches.
 *
 * Used for invalidation when project content changes.
 */
export function clearModuleCaches() {
    moduleCache?.clear();
    esmCache?.clear();
    logger.info("[ModuleCache] All module caches cleared");
}
/**
 * Clear module cache entries for a specific project.
 *
 * @param projectId - The project ID to clear entries for
 * @returns Number of entries cleared
 */
export function clearModuleCacheForProject(projectId) {
    if (!moduleCache)
        return 0;
    let cleared = 0;
    const keysToDelete = [];
    for (const key of moduleCache.keys()) {
        if (key.startsWith(`${projectId}:`)) {
            keysToDelete.push(key);
        }
    }
    for (const key of keysToDelete) {
        moduleCache.delete(key);
        cleared++;
    }
    if (cleared > 0) {
        logger.info("[ModuleCache] Cleared module cache for project", { projectId, cleared });
    }
    return cleared;
}
/**
 * Destroy the module caches and cleanup resources.
 *
 * Should be called on server shutdown.
 */
export function destroyModuleCaches() {
    moduleCache?.destroy();
    esmCache?.destroy();
    moduleCache = null;
    esmCache = null;
    logger.info("[ModuleCache] Module caches destroyed");
}
