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
import { decodeCacheKeySegment } from "#veryfront/cache/keys/segment-codec.ts";
import type { CacheStatsSource } from "#veryfront/cache/registry.ts";
import { cacheNamespaceSegment, hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { rendererLogger, throwIfAborted } from "#veryfront/utils";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import {
  getMaxConcurrentTransforms,
  getTransformPerProjectLimit,
  resetCachedTransformLimits,
  SSR_TMP_DIRS_MAX_ENTRIES,
} from "../constants.ts";
import { Semaphore } from "../concurrency/semaphore.ts";
import { verifiedHttpBundlePaths } from "../http-bundle-helpers.ts";
import type { FailureRecord, ModuleCacheEntry } from "../types.ts";

const logger = rendererLogger.component("ssr-module-loader");

/** Maximum entries for temp path tracking (small, just pointers) */
const TEMP_PATH_CACHE_MAX_ENTRIES = 500;

export const globalModuleCache = new LRUCache<string, ModuleCacheEntry>({
  maxEntries: TEMP_PATH_CACHE_MAX_ENTRIES,
});

export const globalCrossProjectCache = new LRUCache<string, ModuleCacheEntry>({
  maxEntries: TEMP_PATH_CACHE_MAX_ENTRIES,
});

// Each singleflight completion carries its immutable output so requests that
// started before an invalidation can finish without republishing stale state.
export const globalInProgress = new Map<string, Promise<ModuleCacheEntry>>();

export const globalTmpDirs = new LRUCache<string, string>({
  maxEntries: SSR_TMP_DIRS_MAX_ENTRIES,
});

export const failedComponents = new Map<string, FailureRecord>();

export interface ClearSSRModuleCacheForProjectOptions {
  /**
   * Preserve live transform ownership and per-project capacity waiters while
   * clearing request-visible cache entries. Dev SSR request starts use this so
   * concurrent cold requests do not delete another request's transform leader
   * before it can publish its completed cache entry.
   */
  preserveActiveTransforms?: boolean;
}

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
  reject: (reason?: unknown) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
  previous?: ProjectTransformWaiter;
  next?: ProjectTransformWaiter;
};

type ProjectTransformWaiterQueue = {
  head?: ProjectTransformWaiter;
  tail?: ProjectTransformWaiter;
  size: number;
};

// Bound pending work per tenant so transform contention cannot consume
// unbounded memory before the acquisition timeout applies backpressure.
const MAX_PROJECT_TRANSFORM_WAITERS = 1_024;
const projectTransformWaiters = new Map<string, ProjectTransformWaiterQueue>();

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

  if (waiter.previous) waiter.previous.next = waiter.next;
  else queue.head = waiter.next;
  if (waiter.next) waiter.next.previous = waiter.previous;
  else queue.tail = waiter.previous;
  queue.size--;
  waiter.previous = undefined;
  waiter.next = undefined;
  if (queue.size === 0) projectTransformWaiters.delete(projectId);
}

function settleProjectTransformWaiter(
  projectId: string,
  waiter: ProjectTransformWaiter,
  acquired: boolean,
): void {
  removeProjectTransformWaiter(projectId, waiter);
  if (waiter.timeoutId !== undefined) clearTimeout(waiter.timeoutId);
  if (waiter.signal && waiter.onAbort) {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
  }
  waiter.resolve(acquired);
}

function abortProjectTransformWaiter(
  projectId: string,
  waiter: ProjectTransformWaiter,
): void {
  removeProjectTransformWaiter(projectId, waiter);
  if (waiter.timeoutId !== undefined) clearTimeout(waiter.timeoutId);
  if (waiter.signal && waiter.onAbort) {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
  }
  waiter.reject(
    waiter.signal?.reason ?? new DOMException("The operation was aborted", "AbortError"),
  );
}

function wakeNextProjectTransformWaiter(projectId: string): void {
  const limit = getTransformPerProjectLimit();
  if (limit <= 0) return;

  const queue = projectTransformWaiters.get(projectId);
  if (!queue?.head) return;

  const current = projectTransformCounts.get(projectId) ?? 0;
  if (current >= limit) return;

  const waiter = queue.head;
  projectTransformCounts.set(projectId, current + 1);
  settleProjectTransformWaiter(projectId, waiter, true);
}

function rejectProjectTransformWaiters(projectId: string): void {
  const queue = projectTransformWaiters.get(projectId);
  if (!queue?.head) return;

  projectTransformWaiters.delete(projectId);
  let waiter: ProjectTransformWaiter | undefined = queue.head;
  while (waiter) {
    const next: ProjectTransformWaiter | undefined = waiter.next;
    settleProjectTransformWaiter(projectId, waiter, false);
    waiter = next;
  }
}

function rejectAllProjectTransformWaiters(): void {
  const projectIds = Array.from(projectTransformWaiters.keys());
  for (const projectId of projectIds) rejectProjectTransformWaiters(projectId);
}

/**
 * Try to acquire a project-level transform slot with retries.
 * Waits up to timeoutMs for a slot to become available.
 * Returns true if acquired, false if timed out, and rejects with the abort
 * reason when the caller's signal aborts while queued.
 */
export async function tryAcquireTransformSlot(
  projectId: string,
  timeoutMs: number,
  bypass = false,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  if (acquireTransformSlot(projectId, bypass)) return true;
  if (Number.isNaN(timeoutMs) || timeoutMs <= 0) return false;

  return new Promise<boolean>((resolve, reject) => {
    let queue = projectTransformWaiters.get(projectId);
    if (queue && queue.size >= MAX_PROJECT_TRANSFORM_WAITERS) {
      resolve(false);
      return;
    }

    const waiter: ProjectTransformWaiter = {
      resolve,
      reject,
      signal,
    };
    if (Number.isFinite(timeoutMs)) {
      waiter.timeoutId = setTimeout(() => {
        settleProjectTransformWaiter(projectId, waiter, false);
      }, timeoutMs);
    }

    if (!queue) {
      queue = { size: 0 };
      projectTransformWaiters.set(projectId, queue);
    }

    waiter.previous = queue.tail;
    if (queue.tail) queue.tail.next = waiter;
    else queue.head = waiter;
    queue.tail = waiter;
    queue.size++;

    if (signal) {
      waiter.onAbort = () => abortProjectTransformWaiter(projectId, waiter);
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal.aborted) waiter.onAbort();
    }
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
  maxEntries: TEMP_PATH_CACHE_MAX_ENTRIES,
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
  isCrossProjectCacheKeyForProject,
);
registerMapCache("ssr-tmp-dirs", createCacheRegistryWrapper(globalTmpDirs));
registerMapCache("ssr-in-progress", globalInProgress);
registerMapCache("ssr-failed-components", failedComponents);

export function clearSSRModuleCache(): void {
  const moduleCount = globalModuleCache.size;
  const failedCount = failedComponents.size;
  const transformSlotsCount = projectTransformCounts.size;

  globalModuleCache.clear();
  failedComponents.clear();
  projectTransformCounts.clear();
  rejectAllProjectTransformWaiters();
  verifiedHttpBundlePaths.clear();

  // Reset the transform semaphore and cached limits so leaked permits
  // from prior operations don't starve subsequent callers, and env var
  // changes (e.g. in tests) take effect.
  _transformSemaphore = undefined;
  resetCachedTransformLimits();

  logger.debug("Global cache cleared", {
    modulesCleared: moduleCount,
    failedComponentsCleared: failedCount,
    transformSlotsCleared: transformSlotsCount,
  });
}

/**
 * Cross-project cache keys put the raw import specifier before a framed owner.
 * Parse backward from the stable `:registry:` suffix so arbitrary delimiters
 * in the specifier or opaque project id cannot change cache ownership.
 */
function parseCrossProjectCacheKeyOwner(
  key: string,
): { isCrossProjectKey: boolean; projectId?: string } {
  const registryMarker = ":registry:";
  const markerIndex = key.lastIndexOf(registryMarker);
  if (markerIndex < 0) return { isCrossProjectKey: false };

  const ownerMarker = ":owner:";
  const ownerMarkerIndex = key.lastIndexOf(ownerMarker, markerIndex);
  if (ownerMarkerIndex >= 0) {
    const encodedOwner = key.slice(ownerMarkerIndex + ownerMarker.length, markerIndex);
    if (!encodedOwner.includes(":")) {
      return {
        isCrossProjectKey: true,
        projectId: decodeCacheKeySegment(encodedOwner) ?? undefined,
      };
    }
  }

  // Compatibility for cache entries built before owner segments were framed.
  const baseKey = key.slice(0, markerIndex);
  const reactVersionSeparator = baseKey.lastIndexOf(":");
  if (reactVersionSeparator < 0) return { isCrossProjectKey: true };
  const projectSeparator = baseKey.lastIndexOf(":", reactVersionSeparator - 1);
  if (projectSeparator < 0) return { isCrossProjectKey: true };

  return {
    isCrossProjectKey: true,
    projectId: baseKey.slice(projectSeparator + 1, reactVersionSeparator),
  };
}

function isCrossProjectCacheKeyForProject(key: string, projectId: string): boolean {
  const owner = parseCrossProjectCacheKeyOwner(key);
  return owner.isCrossProjectKey ? owner.projectId === projectId : isKeyForProject(key, projectId);
}

export function clearSSRModuleCacheForProject(
  projectId: string,
  options: ClearSSRModuleCacheForProjectOptions = {},
): void {
  let cleared = 0;
  const encodedProjectId = cacheNamespaceSegment(projectId);
  // Tmp dir keys written before the collision-free namespace segments still
  // carry the weak 32-bit project hash; keep clearing those too.
  const legacyEncodedProjectId = hashCodeHex(projectId);
  const preserveActiveTransforms = options.preserveActiveTransforms === true;

  for (const key of globalModuleCache.keys()) {
    if (!isKeyForProject(key, projectId)) continue;
    globalModuleCache.delete(key);
    cleared++;
  }

  for (const key of globalCrossProjectCache.keys()) {
    if (!isCrossProjectCacheKeyForProject(key, projectId)) continue;
    globalCrossProjectCache.delete(key);
  }

  if (!preserveActiveTransforms) {
    for (const key of globalInProgress.keys()) {
      if (!isKeyForProject(key, projectId)) continue;
      globalInProgress.delete(key);
    }
  }

  for (const key of failedComponents.keys()) {
    if (!isKeyForProject(key, projectId)) continue;
    failedComponents.delete(key);
  }

  for (const key of globalTmpDirs.keys()) {
    const parts = key.split("|");
    if (
      parts[2] === encodedProjectId || parts[1] === encodedProjectId ||
      parts[2] === legacyEncodedProjectId || parts[1] === legacyEncodedProjectId
    ) {
      globalTmpDirs.delete(key);
      continue;
    }

    // Legacy cache key format fallback (base:projectId)
    if (key.includes(`:${projectId}`)) {
      globalTmpDirs.delete(key);
    }
  }

  if (!preserveActiveTransforms) {
    projectTransformCounts.delete(projectId);
    rejectProjectTransformWaiters(projectId);
  }

  // Clear verified HTTP bundle paths — keys are tempPath:contentHash (not project-scoped),
  // so full clear is needed. This just forces re-verification on next access.
  verifiedHttpBundlePaths.clear();

  logger.debug("✓ Project cache cleared", {
    projectId,
    entriesCleared: cleared,
    activeTransformsPreserved: preserveActiveTransforms,
    remainingModules: globalModuleCache.size,
  });
}
