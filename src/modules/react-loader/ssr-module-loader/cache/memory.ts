/**
 * Memory Cache for SSR Modules - Redis-First Architecture
 *
 * Optimized for ephemeral pods with limited memory.
 *
 * Strategy:
 * - Redis: Primary storage for transformed code (shared across pods)
 * - Memory: Small LRU cache for temp file path tracking only
 *
 * The actual transformed code lives in Redis and temp files.
 * Memory only stores { tempPath, contentHash } pointers.
 *
 * @module module-system/react-loader/ssr-module-loader/cache/memory
 */

import { registerCache } from "#veryfront/utils/memory/index.ts";
import { registerMapCache } from "#veryfront/cache/keys.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { MAX_CONCURRENT_TRANSFORMS, SSR_TMP_DIRS_MAX_ENTRIES } from "../constants.ts";
import { Semaphore } from "../concurrency/semaphore.ts";
import type { FailureRecord, ModuleCacheEntry } from "../types.ts";

/** Maximum entries for temp path tracking (small, just pointers) */
const TEMP_PATH_CACHE_MAX_ENTRIES = 500;

/**
 * Global module cache - stores temp file paths only.
 * Uses proper LRU eviction for better cache efficiency.
 * The actual transformed code is in Redis.
 */
export const globalModuleCache = new LRUCache<string, ModuleCacheEntry>({
  maxEntries: TEMP_PATH_CACHE_MAX_ENTRIES,
});

/**
 * Cache for cross-project imports (shared across requests).
 * Key format: projectSlug@version/@/path -> tempPath
 */
export const globalCrossProjectCache = new LRUCache<string, ModuleCacheEntry>({
  maxEntries: TEMP_PATH_CACHE_MAX_ENTRIES,
});

/**
 * Map of in-progress transforms to their completion promises.
 * Allows concurrent requests for the same file to wait for the first transform.
 */
export const globalInProgress = new Map<string, Promise<void>>();

/**
 * Temporary directory cache - small LRU cache.
 */
export const globalTmpDirs = new LRUCache<string, string>({
  maxEntries: SSR_TMP_DIRS_MAX_ENTRIES,
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
  maxEntries: TEMP_PATH_CACHE_MAX_ENTRIES,
  mode: "redis-primary-lru-paths",
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

// Register caches with cache registry for project-based lookups
// Using wrapper to expose keys() as Iterable for the registry
const modulePathCache = {
  keys: () => globalModuleCache.keys(),
  get size() {
    return globalModuleCache.size;
  },
  delete: (key: string) => globalModuleCache.delete(key),
};
const crossProjectPathCache = {
  keys: () => globalCrossProjectCache.keys(),
  get size() {
    return globalCrossProjectCache.size;
  },
  delete: (key: string) => globalCrossProjectCache.delete(key),
};
const tmpDirsCache = {
  keys: () => globalTmpDirs.keys(),
  get size() {
    return globalTmpDirs.size;
  },
  delete: (key: string) => globalTmpDirs.delete(key),
};
registerMapCache("ssr-module-cache", modulePathCache as unknown as Map<string, unknown>);
registerMapCache(
  "ssr-cross-project-cache",
  crossProjectPathCache as unknown as Map<string, unknown>,
);
registerMapCache("ssr-tmp-dirs", tmpDirsCache as unknown as Map<string, unknown>);
registerMapCache("ssr-in-progress", globalInProgress);
registerMapCache("ssr-failed-components", failedComponents);

/**
 * Clear the global SSR module cache.
 */
export function clearSSRModuleCache(): void {
  const moduleCount = globalModuleCache.size;
  const failedCount = failedComponents.size;
  globalModuleCache.clear();
  failedComponents.clear();
  logger.info("[SSR-MODULE-LOADER] ✓ Global cache cleared", {
    modulesCleared: moduleCount,
    failedComponentsCleared: failedCount,
  });
}

/**
 * Clear SSR module cache entries for a specific project.
 */
export function clearSSRModuleCacheForProject(projectId: string): void {
  const prefix = `${projectId}:`;
  let cleared = 0;

  // Clear module cache entries for this project
  for (const key of [...globalModuleCache.keys()]) {
    if (key.startsWith(prefix)) {
      globalModuleCache.delete(key);
      cleared++;
    }
  }

  // Clear cross-project cache entries for this project
  for (const key of [...globalCrossProjectCache.keys()]) {
    if (key.includes(projectId)) {
      globalCrossProjectCache.delete(key);
    }
  }

  // Clear in-progress entries for this project
  for (const key of [...globalInProgress.keys()]) {
    if (key.startsWith(prefix)) {
      globalInProgress.delete(key);
    }
  }

  // Clear failed components for this project
  for (const key of [...failedComponents.keys()]) {
    if (key.startsWith(prefix)) {
      failedComponents.delete(key);
    }
  }

  // Clear tmp dir cache for this project
  for (const key of [...globalTmpDirs.keys()]) {
    if (key.includes(`:${projectId}`)) {
      globalTmpDirs.delete(key);
    }
  }

  logger.info("[SSR-MODULE-LOADER] ✓ Project cache cleared", {
    projectId,
    prefix,
    entriesCleared: cleared,
    remainingModules: globalModuleCache.size,
  });
}
