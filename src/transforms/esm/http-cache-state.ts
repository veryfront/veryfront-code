/**
 * Shared in-memory cache state for HTTP module caching.
 *
 * Manages the LRU caches, processing stacks, and distributed cache refresh
 * tracking. Provides dependency injection for testing.
 *
 * @module transforms/esm/http-cache-state
 */

import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { HTTP_MODULE_CACHE_MAX_ENTRIES } from "#veryfront/utils/constants/cache.ts";
import type { HttpCacheLike, SetLike } from "./http-cache-helpers.ts";
import { inFlightHttpFetches, processingStackStorage } from "./in-flight-manager.ts";

const defaultCachedPaths = new LRUCache<string, string>({
  maxEntries: HTTP_MODULE_CACHE_MAX_ENTRIES,
});
const defaultProcessingStack = new Set<string>();

/** Tracks last TTL refresh per hash. Refresh every 4h to keep 20h+ remaining (24h total). */
const defaultLastDistributedRefresh = new LRUCache<string, number>({
  maxEntries: HTTP_MODULE_CACHE_MAX_ENTRIES,
});

/** Injected caches for testing */
let injectedCachedPaths: HttpCacheLike<string, string> | null = null;
let injectedProcessingStack: SetLike<string> | null = null;
let injectedLastDistributedRefresh: HttpCacheLike<string, number> | null = null;

export function getCachedPaths(): HttpCacheLike<string, string> {
  return injectedCachedPaths ?? defaultCachedPaths;
}

export function getProcessingStack(): SetLike<string> {
  if (injectedProcessingStack) return injectedProcessingStack;
  return processingStackStorage.getStore() ?? defaultProcessingStack;
}

export function getLastDistributedRefresh(): HttpCacheLike<string, number> {
  return injectedLastDistributedRefresh ?? defaultLastDistributedRefresh;
}

/** Check if a test-injected processing stack is active (used to skip AsyncLocalStorage.run). */
export function hasInjectedProcessingStack(): boolean {
  return injectedProcessingStack !== null;
}

/**
 * Inject custom caches for testing.
 * Call with null to restore default behavior.
 */
export function __injectCachesForTests(
  caches: {
    cachedPaths?: HttpCacheLike<string, string> | null;
    processingStack?: SetLike<string> | null;
    lastDistributedRefresh?: HttpCacheLike<string, number> | null;
  } | null,
): void {
  if (caches === null) {
    injectedCachedPaths = null;
    injectedProcessingStack = null;
    injectedLastDistributedRefresh = null;
    inFlightHttpFetches.clear();
    return;
  }

  if (caches.cachedPaths !== undefined) injectedCachedPaths = caches.cachedPaths;
  if (caches.processingStack !== undefined) injectedProcessingStack = caches.processingStack;
  if (caches.lastDistributedRefresh !== undefined) {
    injectedLastDistributedRefresh = caches.lastDistributedRefresh;
  }
}
