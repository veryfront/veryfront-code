/**
 * RSC handler registry for managing per-project handlers
 *
 * Supports optional cache injection for testing.
 *
 * @module rsc-endpoints/handler-registry
 */

import { RSCDevServerHandler } from "../orchestrators/index.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";

const RSC_HANDLERS_MAX_ENTRIES = 50;
const RSC_HANDLERS_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Handler cache interface for dependency injection.
 * Simplified interface that matches LRUCache's essential methods.
 */
export interface HandlerCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  clear(): void;
  readonly size: number;
}

let rscHandlersByProject: LRUCache<string, RSCDevServerHandler> | null = null;
let cacheRegistered = false;

/** Injected cache for testing (overrides default LRUCache) */
let injectedCache: HandlerCache<RSCDevServerHandler> | null = null;

function getHandlersCache(): HandlerCache<RSCDevServerHandler> {
  // Use injected cache if available (for testing)
  if (injectedCache) return injectedCache;

  if (rscHandlersByProject) return rscHandlersByProject;

  rscHandlersByProject = new LRUCache<string, RSCDevServerHandler>({
    maxEntries: RSC_HANDLERS_MAX_ENTRIES,
    ttlMs: RSC_HANDLERS_TTL_MS,
    cleanupIntervalMs: 300000, // 5 minutes
  });

  if (!cacheRegistered) {
    registerCache("rsc-handlers", () => ({
      name: "rsc-handlers",
      entries: rscHandlersByProject?.size ?? 0,
      maxEntries: RSC_HANDLERS_MAX_ENTRIES,
    }));
    cacheRegistered = true;
  }

  return rscHandlersByProject;
}

export function getRSCHandler(projectDir: string): RSCDevServerHandler {
  const cache = getHandlersCache();
  const existing = cache.get(projectDir);
  if (existing) return existing;

  const handler = new RSCDevServerHandler(projectDir);
  cache.set(projectDir, handler);
  return handler;
}

/**
 * Inject a custom cache for testing.
 * Call with null to restore default behavior.
 *
 * @example
 * ```typescript
 * const mockCache = new Map<string, RSCDevServerHandler>();
 * __injectCacheForTests({
 *   get: (key) => mockCache.get(key),
 *   set: (key, value) => { mockCache.set(key, value); },
 *   clear: () => mockCache.clear(),
 *   get size() { return mockCache.size; },
 * });
 * ```
 */
export function __injectCacheForTests(
  cache: HandlerCache<RSCDevServerHandler> | null,
): void {
  injectedCache = cache;
}

export function __resetRSCHandlerForTests(): void {
  if (injectedCache) {
    injectedCache.clear();
  } else {
    rscHandlersByProject?.clear();
  }
}

export function __destroyRSCHandlerForTests(): void {
  injectedCache = null;
  rscHandlersByProject?.destroy();
  rscHandlersByProject = null;
}
