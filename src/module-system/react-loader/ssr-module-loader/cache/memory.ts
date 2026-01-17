/**
 * Memory Cache for SSR Modules - Redis-First Architecture
 *
 * Optimized for ephemeral pods with limited memory.
 *
 * Strategy:
 * - Redis: Primary storage for transformed code (shared across pods)
 * - Memory: Small bounded map for temp file path tracking only
 *
 * The actual transformed code lives in Redis and temp files.
 * Memory only stores { tempPath, contentHash } pointers.
 *
 * @module module-system/react-loader/ssr-module-loader/cache/memory
 */

import { registerCache } from "@veryfront/core/memory/index.ts";
import { registerMapCache } from "@veryfront/core/cache/keys.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { MAX_CONCURRENT_TRANSFORMS, SSR_TMP_DIRS_MAX_ENTRIES } from "../constants.ts";
import { Semaphore } from "../concurrency/semaphore.ts";
import type { FailureRecord, ModuleCacheEntry } from "../types.ts";

/** Maximum entries for temp path tracking (small, just pointers) */
const TEMP_PATH_CACHE_MAX_ENTRIES = 500;

/**
 * Bounded Map for temp file path tracking.
 * Only stores { tempPath, contentHash } pointers, not the actual code.
 * The code lives in Redis and temp files.
 */
class BoundedMap<K, V> {
  private map = new Map<K, V>();
  constructor(private maxEntries: number) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      // Remove oldest entry (first in map)
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.map[Symbol.iterator]();
  }
}

/**
 * Global module cache - stores temp file paths only.
 * The actual transformed code is in Redis.
 */
export const globalModuleCache = new BoundedMap<string, ModuleCacheEntry>(
  TEMP_PATH_CACHE_MAX_ENTRIES,
);

/**
 * Cache for cross-project imports (shared across requests).
 * Key format: projectSlug@version/@/path -> tempPath
 */
export const globalCrossProjectCache = new BoundedMap<string, ModuleCacheEntry>(
  TEMP_PATH_CACHE_MAX_ENTRIES,
);

/**
 * Map of in-progress transforms to their completion promises.
 * Allows concurrent requests for the same file to wait for the first transform.
 */
export const globalInProgress = new Map<string, Promise<void>>();

/**
 * Temporary directory cache - small bounded map.
 */
export const globalTmpDirs = new BoundedMap<string, string>(SSR_TMP_DIRS_MAX_ENTRIES);

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
  mode: "redis-primary-memory-paths",
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
  size: globalModuleCache.size,
  delete: (key: string) => globalModuleCache.delete(key),
};
const crossProjectPathCache = {
  keys: () => globalCrossProjectCache.keys(),
  size: globalCrossProjectCache.size,
  delete: (key: string) => globalCrossProjectCache.delete(key),
};
registerMapCache("ssr-module-cache", modulePathCache as unknown as Map<string, unknown>);
registerMapCache(
  "ssr-cross-project-cache",
  crossProjectPathCache as unknown as Map<string, unknown>,
);
registerMapCache("ssr-in-progress", globalInProgress);
registerMapCache("ssr-failed-components", failedComponents);

/**
 * Clear the global SSR module cache.
 */
export function clearSSRModuleCache(): void {
  globalModuleCache.clear();
  failedComponents.clear();
  logger.debug("[SSR-MODULE-LOADER] Cache cleared");
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

  if (cleared > 0) {
    logger.debug("[SSR-MODULE-LOADER] Project cache cleared", {
      projectId,
      entriesCleared: cleared,
    });
  }
}
