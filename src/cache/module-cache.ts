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

import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { registerLRUCache } from "./registry.ts";
import {
  ESM_CACHE_MAX_ENTRIES,
  ESM_CACHE_TTL_MS,
  MODULE_CACHE_MAX_ENTRIES,
  MODULE_CACHE_TTL_MS,
} from "#veryfront/utils/constants/cache.ts";

/**
 * Pod-level module cache singleton.
 *
 * Maps module cache keys to transformed temp file paths.
 * Key format: `{projectId}:{filePath}`
 */
let moduleCache: LRUCache<string, string> | null = null;

/**
 * Pod-level ESM cache singleton.
 *
 * Maps ESM specifiers to resolved URLs or file paths.
 * Key format varies by usage.
 */
let esmCache: LRUCache<string, string> | null = null;

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
export function getModuleCache(): LRUCache<string, string> {
  if (!moduleCache) {
    moduleCache = new LRUCache<string, string>({
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
export function getEsmCache(): LRUCache<string, string> {
  if (!esmCache) {
    esmCache = new LRUCache<string, string>({
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
export function createModuleCache(): Map<string, string> {
  const cache = getModuleCache();
  return createMapInterface(cache);
}

/**
 * Create a Map-compatible interface for the ESM cache.
 *
 * This provides backward compatibility with code expecting Map<string, string>.
 */
export function createEsmCache(): Map<string, string> {
  const cache = getEsmCache();
  return createMapInterface(cache);
}

/**
 * Create a Map-compatible interface backed by an LRU cache.
 */
function createMapInterface(cache: LRUCache<string, string>): Map<string, string> {
  // Create a proxy that delegates to the LRU cache
  // This allows existing code expecting Map to work unchanged
  return {
    get(key: string): string | undefined {
      return cache.get(key);
    },
    set(key: string, value: string): Map<string, string> {
      cache.set(key, value);
      return this;
    },
    has(key: string): boolean {
      return cache.has(key);
    },
    delete(key: string): boolean {
      return cache.delete(key);
    },
    clear(): void {
      cache.clear();
    },
    get size(): number {
      return cache.size;
    },
    // Required Map methods that iterate - these work but may be expensive
    *keys(): IterableIterator<string> {
      yield* cache.keys();
    },
    *values(): IterableIterator<string> {
      for (const key of cache.keys()) {
        const value = cache.get(key);
        if (value !== undefined) yield value;
      }
    },
    *entries(): IterableIterator<[string, string]> {
      for (const key of cache.keys()) {
        const value = cache.get(key);
        if (value !== undefined) yield [key, value];
      }
    },
    forEach(callback: (value: string, key: string, map: Map<string, string>) => void): void {
      for (const key of cache.keys()) {
        const value = cache.get(key);
        if (value !== undefined) callback(value, key, this);
      }
    },
    [Symbol.iterator](): IterableIterator<[string, string]> {
      return this.entries();
    },
    [Symbol.toStringTag]: "Map",
  } as Map<string, string>;
}

/**
 * Get statistics about the module caches.
 */
export function getModuleCacheStats(): ModuleCacheStats {
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
export function clearModuleCaches(): void {
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
export function clearModuleCacheForProject(projectId: string): number {
  if (!moduleCache) return 0;

  let cleared = 0;
  const keysToDelete: string[] = [];

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
export function destroyModuleCaches(): void {
  moduleCache?.destroy();
  esmCache?.destroy();
  moduleCache = null;
  esmCache = null;
  logger.info("[ModuleCache] Module caches destroyed");
}
