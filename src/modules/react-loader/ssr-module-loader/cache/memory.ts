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
import { isKeyForProject, registerMapCache } from "#veryfront/cache/keys.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import {
  MAX_CONCURRENT_TRANSFORMS,
  SSR_TMP_DIRS_MAX_ENTRIES,
  TRANSFORM_PER_PROJECT_LIMIT,
} from "../constants.ts";
import { Semaphore } from "../concurrency/semaphore.ts";
import { verifiedHttpBundlePaths } from "../http-bundle-helpers.ts";
import type { FailureRecord, ModuleCacheEntry } from "../types.ts";

/** Maximum entries for temp path tracking (small, just pointers) */
const TEMP_PATH_CACHE_MAX_ENTRIES = 500;

export const globalModuleCache = new LRUCache<string, ModuleCacheEntry>({
  maxEntries: TEMP_PATH_CACHE_MAX_ENTRIES,
});

export const globalCrossProjectCache = new LRUCache<string, ModuleCacheEntry>({
  maxEntries: TEMP_PATH_CACHE_MAX_ENTRIES,
});

export const globalInProgress = new Map<string, Promise<void>>();

export const globalTmpDirs = new LRUCache<string, string>({
  maxEntries: SSR_TMP_DIRS_MAX_ENTRIES,
});

export const failedComponents = new Map<string, FailureRecord>();

export const transformSemaphore = new Semaphore(MAX_CONCURRENT_TRANSFORMS);

/**
 * Per-project active transform counter. Prevents a single noisy tenant from
 * monopolizing the global semaphore and starving other projects.
 * Only enforced when TRANSFORM_PER_PROJECT_LIMIT > 0.
 */
const projectTransformCounts = new Map<string, number>();

/**
 * Projects that bypass per-project rate limiting.
 * - "__single__": Used for local development and tests where there's no multi-tenancy
 */
const RATE_LIMIT_BYPASS_PROJECTS = new Set(["__single__"]);

/**
 * Attempt to acquire a project-level transform slot immediately.
 * Returns true if acquired, false if project is at capacity.
 *
 * Note: The "__single__" project (used in local dev and tests) bypasses
 * rate limiting since there's no noisy-neighbor concern in single-project mode.
 */
export function acquireTransformSlot(projectId: string): boolean {
  if (TRANSFORM_PER_PROJECT_LIMIT <= 0) return true;
  // Bypass rate limiting for local/test mode (no multi-tenancy concern)
  if (RATE_LIMIT_BYPASS_PROJECTS.has(projectId)) return true;
  const current = projectTransformCounts.get(projectId) ?? 0;
  if (current >= TRANSFORM_PER_PROJECT_LIMIT) return false;
  projectTransformCounts.set(projectId, current + 1);
  return true;
}

/** How long to wait between retry attempts for per-project slots */
const PROJECT_SLOT_RETRY_INTERVAL_MS = 50;

/**
 * Try to acquire a project-level transform slot with retries.
 * Waits up to timeoutMs for a slot to become available.
 * Returns true if acquired, false if timed out.
 */
export async function tryAcquireTransformSlot(
  projectId: string,
  timeoutMs: number,
): Promise<boolean> {
  // Try immediate acquisition first
  if (acquireTransformSlot(projectId)) return true;

  // Retry with backoff until timeout
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, PROJECT_SLOT_RETRY_INTERVAL_MS));
    if (acquireTransformSlot(projectId)) return true;
  }
  return false;
}

/**
 * Release a project-level transform slot.
 */
export function releaseTransformSlot(projectId: string): void {
  if (TRANSFORM_PER_PROJECT_LIMIT <= 0) return;
  const current = projectTransformCounts.get(projectId) ?? 0;
  if (current <= 1) {
    projectTransformCounts.delete(projectId);
  } else {
    projectTransformCounts.set(projectId, current - 1);
  }
}

/**
 * Get per-project transform statistics.
 */
export function getTransformStats(): {
  globalAvailable: number;
  globalWaiting: number;
  perProjectLimit: number;
  activeProjects: Map<string, number>;
} {
  return {
    globalAvailable: transformSemaphore.available,
    globalWaiting: transformSemaphore.waiting,
    perProjectLimit: TRANSFORM_PER_PROJECT_LIMIT,
    activeProjects: new Map(projectTransformCounts),
  };
}

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
  perProjectLimit: TRANSFORM_PER_PROJECT_LIMIT,
  activeProjects: Object.fromEntries(projectTransformCounts),
}));

function createCacheRegistryWrapper<T>(cache: LRUCache<string, T>) {
  return {
    keys: () => cache.keys(),
    get size() {
      return cache.size;
    },
    delete: (key: string) => cache.delete(key),
  };
}

registerMapCache(
  "ssr-module-cache",
  createCacheRegistryWrapper(globalModuleCache) as unknown as Map<string, unknown>,
);
registerMapCache(
  "ssr-cross-project-cache",
  createCacheRegistryWrapper(globalCrossProjectCache) as unknown as Map<string, unknown>,
);
registerMapCache(
  "ssr-tmp-dirs",
  createCacheRegistryWrapper(globalTmpDirs) as unknown as Map<string, unknown>,
);
registerMapCache("ssr-in-progress", globalInProgress);
registerMapCache("ssr-failed-components", failedComponents);

export function clearSSRModuleCache(): void {
  const moduleCount = globalModuleCache.size;
  const failedCount = failedComponents.size;
  const transformSlotsCount = projectTransformCounts.size;

  globalModuleCache.clear();
  failedComponents.clear();
  projectTransformCounts.clear();
  verifiedHttpBundlePaths.clear();

  logger.info("[SSR-MODULE-LOADER] ✓ Global cache cleared", {
    modulesCleared: moduleCount,
    failedComponentsCleared: failedCount,
    transformSlotsCleared: transformSlotsCount,
  });
}

export function clearSSRModuleCacheForProject(projectId: string): void {
  let cleared = 0;

  for (const key of globalModuleCache.keys()) {
    if (!isKeyForProject(key, projectId)) continue;
    globalModuleCache.delete(key);
    cleared++;
  }

  for (const key of globalCrossProjectCache.keys()) {
    if (!key.includes(projectId) && !isKeyForProject(key, projectId)) continue;
    globalCrossProjectCache.delete(key);
  }

  for (const key of globalInProgress.keys()) {
    if (!isKeyForProject(key, projectId)) continue;
    globalInProgress.delete(key);
  }

  for (const key of failedComponents.keys()) {
    if (!isKeyForProject(key, projectId)) continue;
    failedComponents.delete(key);
  }

  for (const key of globalTmpDirs.keys()) {
    if (!key.includes(`:${projectId}`)) continue;
    globalTmpDirs.delete(key);
  }

  // Clear project's transform slot count
  projectTransformCounts.delete(projectId);

  // Clear verified HTTP bundle paths — keys are tempPath:contentHash (not project-scoped),
  // so full clear is needed. This just forces re-verification on next access.
  verifiedHttpBundlePaths.clear();

  logger.debug("[SSR-MODULE-LOADER] ✓ Project cache cleared", {
    projectId,
    entriesCleared: cleared,
    remainingModules: globalModuleCache.size,
  });
}
