/**
 * Memory Cache for SSR Modules
 *
 * Global LRU caches shared across all SSRModuleLoader instances.
 *
 * @module module-system/react-loader/ssr-module-loader/cache/memory
 */

import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import { registerCache } from "@veryfront/core/memory/index.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import {
  MAX_CONCURRENT_TRANSFORMS,
  SSR_MODULE_CACHE_MAX_ENTRIES,
  SSR_MODULE_CACHE_TTL_MS,
  SSR_TMP_DIRS_MAX_ENTRIES,
} from "../constants.ts";
import { Semaphore } from "../concurrency/semaphore.ts";
import type { FailureRecord, ModuleCacheEntry } from "../types.ts";

/**
 * Global module cache shared across all SSRModuleLoader instances.
 * Keys include projectId to isolate caches between different projects.
 */
export const globalModuleCache = new LRUCache<string, ModuleCacheEntry>({
  maxEntries: SSR_MODULE_CACHE_MAX_ENTRIES,
  ttlMs: SSR_MODULE_CACHE_TTL_MS,
  cleanupIntervalMs: 60000,
});

/**
 * Cache for cross-project imports (shared across requests).
 * Key format: projectSlug@version/@/path -> tempPath
 */
export const globalCrossProjectCache = new LRUCache<string, ModuleCacheEntry>({
  maxEntries: SSR_MODULE_CACHE_MAX_ENTRIES,
  ttlMs: SSR_MODULE_CACHE_TTL_MS,
  cleanupIntervalMs: 60000,
});

/**
 * Map of in-progress transforms to their completion promises.
 * Allows concurrent requests for the same file to wait for the first transform.
 */
export const globalInProgress = new Map<string, Promise<void>>();

/**
 * Temporary directory cache.
 */
export const globalTmpDirs = new LRUCache<string, string>({
  maxEntries: SSR_TMP_DIRS_MAX_ENTRIES,
  ttlMs: 60 * 60 * 1000, // 1 hour
});

/**
 * Circuit breaker tracking for failed components.
 */
export const failedComponents = new Map<string, FailureRecord>();

/**
 * Global semaphore for limiting concurrent transforms.
 */
export const transformSemaphore = new Semaphore(MAX_CONCURRENT_TRANSFORMS);

// Register caches with memory profiler
registerCache("ssr-module-cache", () => ({
  name: "ssr-module-cache",
  entries: globalModuleCache.size,
  maxEntries: SSR_MODULE_CACHE_MAX_ENTRIES,
  redisEnabled: false, // Will be updated by redis module
}));

registerCache("ssr-tmp-dirs", () => ({
  name: "ssr-tmp-dirs",
  entries: globalTmpDirs.size,
  maxEntries: SSR_TMP_DIRS_MAX_ENTRIES,
}));

registerCache("ssr-transform-semaphore", () => ({
  name: "ssr-transform-semaphore",
  entries: MAX_CONCURRENT_TRANSFORMS - transformSemaphore.available,
  maxEntries: MAX_CONCURRENT_TRANSFORMS,
  waiting: transformSemaphore.waiting,
}));

/**
 * Clear the global SSR module cache.
 */
export function clearSSRModuleCache(): void {
  globalModuleCache.clear();
  failedComponents.clear();
  logger.info("[SSR-MODULE-LOADER] Cache cleared");
}

/**
 * Clear SSR module cache entries for a specific project.
 */
export function clearSSRModuleCacheForProject(projectId: string): void {
  const prefix = `${projectId}:`;
  let cleared = 0;

  // Clear module cache entries for this project
  for (const key of globalModuleCache.keys()) {
    if (typeof key === "string" && key.startsWith(prefix)) {
      globalModuleCache.delete(key);
      cleared++;
    }
  }

  // Clear in-progress entries for this project
  for (const key of globalInProgress.keys()) {
    if (key.startsWith(prefix)) {
      globalInProgress.delete(key);
    }
  }

  // Clear failed components for this project
  for (const key of failedComponents.keys()) {
    if (key.startsWith(prefix)) {
      failedComponents.delete(key);
    }
  }

  // Clear tmp dir cache for this project
  for (const key of globalTmpDirs.keys()) {
    if (typeof key === "string" && key.includes(`:${projectId}`)) {
      globalTmpDirs.delete(key);
    }
  }

  if (cleared > 0) {
    logger.info("[SSR-MODULE-LOADER] Project cache cleared", {
      projectId,
      entriesCleared: cleared,
    });
  }
}
