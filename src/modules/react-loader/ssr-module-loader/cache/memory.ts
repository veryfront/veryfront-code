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
import type { CacheStatsSource } from "#veryfront/cache/registry.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { rendererLogger } from "#veryfront/utils";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import {
  FAILED_COMPONENT_CACHE_MAX_ENTRIES,
  getMaxConcurrentTransforms,
  getTransformPerProjectLimit,
  MAX_PROJECT_TRANSFORM_WAITERS,
  resetCachedTransformLimits,
  SSR_MODULE_CACHE_MAX_ENTRIES,
  SSR_MODULE_CACHE_TTL_MS,
  SSR_TMP_DIRS_MAX_ENTRIES,
} from "../constants.ts";
import { Semaphore } from "../concurrency/semaphore.ts";
import { verifiedHttpBundlePaths } from "../http-bundle-helpers.ts";
import type { FailureRecord, ModuleCacheEntry } from "../types.ts";
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";

const logger = rendererLogger.component("ssr-module-loader");

/** Maximum entries for immutable cross-project temp path pointers. */
const CROSS_PROJECT_CACHE_MAX_ENTRIES = 500;

export const globalModuleCache = new LRUCache<string, ModuleCacheEntry>({
  maxEntries: SSR_MODULE_CACHE_MAX_ENTRIES,
  ttlMs: SSR_MODULE_CACHE_TTL_MS,
});

export const globalCrossProjectCache = new LRUCache<string, ModuleCacheEntry>({
  maxEntries: CROSS_PROJECT_CACHE_MAX_ENTRIES,
  ttlMs: SSR_MODULE_CACHE_TTL_MS,
});

export const globalInProgress = new Map<string, Promise<void>>();
export const globalCrossProjectInProgress = new Map<string, Promise<string>>();

export const globalTmpDirs = new LRUCache<string, string>({
  maxEntries: SSR_TMP_DIRS_MAX_ENTRIES,
});

export const failedComponents = new LRUCache<string, FailureRecord>({
  maxEntries: FAILED_COMPONENT_CACHE_MAX_ENTRIES,
});

let _transformSemaphore: Semaphore | undefined;
export function getTransformSemaphore(): Semaphore {
  if (!_transformSemaphore) {
    _transformSemaphore = new Semaphore(getMaxConcurrentTransforms());
  }
  return _transformSemaphore;
}

/**
 * Per-project active transform counter. Prevents a single noisy tenant from
 * monopolizing the global semaphore and starving other projects.
 * Only enforced when TRANSFORM_PER_PROJECT_LIMIT > 0.
 */
const projectTransformCounts = new Map<string, number>();

type ProjectTransformWaiter = {
  resolve: (acquired: boolean) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

const projectTransformWaiters = new Map<string, ProjectTransformWaiter[]>();

/**
 * Projects that bypass per-project rate limiting.
 * - "__single__": Used for local development and tests where there's no multi-tenancy
 */
const RATE_LIMIT_BYPASS_PROJECTS = new Set(["__single__"]);

/**
 * Project ID prefixes that bypass per-project rate limiting.
 * - "local-": Used for compiled binary CLI, local filesystem projects
 *   where there's no multi-tenancy and noisy-neighbor protection isn't needed.
 * - "test_": Used by integration tests (TestContext.projectId) where there's
 *   no multi-tenancy concern and rate limiting causes flaky failures under CI load.
 */
const RATE_LIMIT_BYPASS_PREFIXES = ["local-", "test_"];

/**
 * Attempt to acquire a project-level transform slot immediately.
 * Returns true if acquired, false if project is at capacity.
 *
 * Note: The "__single__" project and projects with "local-" prefix bypass
 * rate limiting since there's no noisy-neighbor concern in single-project mode.
 * `bypass` forces the same behavior for callers that know they are
 * single-tenant (e.g. the dev server, whose projectId is the project slug and
 * therefore does not match the prefix allowlist). When bypassing, no slot is
 * tracked, so the matching {@link releaseTransformSlot} must also bypass.
 */
export function acquireTransformSlot(projectId: string, bypass = false): boolean {
  const limit = getTransformPerProjectLimit();
  if (limit <= 0) return true;
  if (bypass) return true;
  if (RATE_LIMIT_BYPASS_PROJECTS.has(projectId)) return true;
  if (RATE_LIMIT_BYPASS_PREFIXES.some((prefix) => projectId.startsWith(prefix))) return true;

  const current = projectTransformCounts.get(projectId) ?? 0;
  if (current >= limit) return false;

  projectTransformCounts.set(projectId, current + 1);
  return true;
}

function removeProjectTransformWaiter(
  projectId: string,
  waiter: ProjectTransformWaiter,
): void {
  const queue = projectTransformWaiters.get(projectId);
  if (!queue) return;

  const index = queue.indexOf(waiter);
  if (index !== -1) queue.splice(index, 1);
  if (queue.length === 0) projectTransformWaiters.delete(projectId);
}

function settleProjectTransformWaiter(
  projectId: string,
  waiter: ProjectTransformWaiter,
  acquired: boolean,
): void {
  removeProjectTransformWaiter(projectId, waiter);
  clearTimeout(waiter.timeoutId);
  waiter.resolve(acquired);
}

function wakeNextProjectTransformWaiter(projectId: string): void {
  const limit = getTransformPerProjectLimit();
  if (limit <= 0) return;

  const queue = projectTransformWaiters.get(projectId);
  if (!queue?.length) return;

  const current = projectTransformCounts.get(projectId) ?? 0;
  if (current >= limit) return;

  const waiter = queue.shift();
  if (queue.length === 0) projectTransformWaiters.delete(projectId);
  if (!waiter) return;

  projectTransformCounts.set(projectId, current + 1);
  clearTimeout(waiter.timeoutId);
  waiter.resolve(true);
}

function rejectProjectTransformWaiters(projectId: string): void {
  const queue = projectTransformWaiters.get(projectId);
  if (!queue?.length) return;

  projectTransformWaiters.delete(projectId);
  for (const waiter of queue) {
    clearTimeout(waiter.timeoutId);
    waiter.resolve(false);
  }
}

function rejectAllProjectTransformWaiters(): void {
  const projectIds = Array.from(projectTransformWaiters.keys());
  for (const projectId of projectIds) rejectProjectTransformWaiters(projectId);
}

/**
 * Try to acquire a project-level transform slot with retries.
 * Waits up to timeoutMs for a slot to become available.
 * Returns true if acquired, false if timed out.
 */
export async function tryAcquireTransformSlot(
  projectId: string,
  timeoutMs: number,
  bypass = false,
): Promise<boolean> {
  if (acquireTransformSlot(projectId, bypass)) return true;
  if (timeoutMs <= 0) return false;

  return new Promise<boolean>((resolve) => {
    const waiter: ProjectTransformWaiter = {
      resolve,
      timeoutId: setTimeout(() => {
        settleProjectTransformWaiter(projectId, waiter, false);
      }, timeoutMs),
    };

    const queue = projectTransformWaiters.get(projectId);
    if (queue) {
      if (queue.length >= MAX_PROJECT_TRANSFORM_WAITERS) {
        clearTimeout(waiter.timeoutId);
        resolve(false);
        return;
      }
      queue.push(waiter);
      return;
    }

    projectTransformWaiters.set(projectId, [waiter]);
  });
}

/**
 * Release a project-level transform slot. `bypass` must match the value
 * passed to the corresponding {@link acquireTransformSlot} so a bypassing
 * caller never decrements another caller's tracked count.
 */
export function releaseTransformSlot(projectId: string, bypass = false): void {
  if (bypass || getTransformPerProjectLimit() <= 0) return;

  const current = projectTransformCounts.get(projectId) ?? 0;
  if (current <= 1) {
    projectTransformCounts.delete(projectId);
    wakeNextProjectTransformWaiter(projectId);
    return;
  }

  projectTransformCounts.set(projectId, current - 1);
  wakeNextProjectTransformWaiter(projectId);
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
    globalAvailable: getTransformSemaphore().available,
    globalWaiting: getTransformSemaphore().waiting,
    perProjectLimit: getTransformPerProjectLimit(),
    activeProjects: new Map(projectTransformCounts),
  };
}

registerCache("ssr-module-cache", () => ({
  name: "ssr-module-cache",
  entries: globalModuleCache.size,
  maxEntries: SSR_MODULE_CACHE_MAX_ENTRIES,
  mode: "redis-primary-lru-paths",
}));

registerCache("ssr-tmp-dirs", () => ({
  name: "ssr-tmp-dirs",
  entries: globalTmpDirs.size,
  maxEntries: SSR_TMP_DIRS_MAX_ENTRIES,
}));

registerCache("ssr-transform-semaphore", () => {
  const semaphore = getTransformSemaphore();
  const maxConcurrent = getMaxConcurrentTransforms();
  return {
    name: "ssr-transform-semaphore",
    entries: maxConcurrent - semaphore.available,
    maxEntries: maxConcurrent,
    waiting: semaphore.waiting,
    perProjectLimit: getTransformPerProjectLimit(),
    activeProjects: Object.fromEntries(projectTransformCounts),
  };
});

function createCacheRegistryWrapper<T>(
  cache: LRUCache<string, T>,
): CacheStatsSource {
  return {
    get: (key: string) => cache.get(key),
    keys: () => cache.keys(),
    get size() {
      return cache.size;
    },
    delete: (key: string) => cache.delete(key),
  };
}

registerMapCache("ssr-module-cache", createCacheRegistryWrapper(globalModuleCache));
registerMapCache(
  "ssr-cross-project-cache",
  createCacheRegistryWrapper(globalCrossProjectCache),
);
registerMapCache("ssr-tmp-dirs", createCacheRegistryWrapper(globalTmpDirs));
registerMapCache("ssr-in-progress", globalInProgress);
registerMapCache("ssr-cross-project-in-progress", globalCrossProjectInProgress);
registerMapCache(
  "ssr-failed-components",
  createCacheRegistryWrapper(failedComponents),
);

export function clearSSRModuleCache(): void {
  const moduleCount = globalModuleCache.size;
  const failedCount = failedComponents.size;
  const transformSlotsCount = projectTransformCounts.size;

  globalModuleCache.clear();
  globalCrossProjectCache.clear();
  globalCrossProjectInProgress.clear();
  globalInProgress.clear();
  globalTmpDirs.clear();
  failedComponents.clear();
  projectTransformCounts.clear();
  rejectAllProjectTransformWaiters();
  verifiedHttpBundlePaths.clear();

  // Reset the transform semaphore and cached limits so leaked permits
  // from prior operations don't starve subsequent callers, and env var
  // changes (e.g. in tests) take effect.
  _transformSemaphore = undefined;
  resetCachedTransformLimits();

  logger.info("✓ Global cache cleared", {
    modulesCleared: moduleCount,
    failedComponentsCleared: failedCount,
    transformSlotsCleared: transformSlotsCount,
  });
}

registerProcessStateReset("SSR module cache", clearSSRModuleCache);

export function clearSSRModuleCacheForProject(projectId: string): void {
  let cleared = 0;
  const encodedProjectId = hashString(projectId);

  for (const key of globalModuleCache.keys()) {
    if (!isKeyForProject(key, projectId)) continue;
    globalModuleCache.delete(key);
    cleared++;
  }

  for (const key of globalCrossProjectCache.keys()) {
    if (!isKeyForProject(key, projectId)) continue;
    globalCrossProjectCache.delete(key);
  }

  for (const key of globalCrossProjectInProgress.keys()) {
    if (!isKeyForProject(key, projectId)) continue;
    globalCrossProjectInProgress.delete(key);
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
    try {
      const parts: unknown = JSON.parse(key);
      if (Array.isArray(parts) && parts.length === 4 && parts[2] === encodedProjectId) {
        globalTmpDirs.delete(key);
      }
    } catch {
      // Ignore unknown keys. Cache invalidation only acts on canonical identities.
    }
  }

  projectTransformCounts.delete(projectId);
  rejectProjectTransformWaiters(projectId);

  // Clear verified HTTP bundle paths. Keys are path/hash tuples without a project field,
  // so full clear is needed. This just forces re-verification on next access.
  verifiedHttpBundlePaths.clear();

  logger.debug("✓ Project cache cleared", {
    entriesCleared: cleared,
    remainingModules: globalModuleCache.size,
  });
}
