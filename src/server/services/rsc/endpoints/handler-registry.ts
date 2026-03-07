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
const RSC_HANDLERS_CLEANUP_INTERVAL_MS = 300_000; // 5 minutes

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
  if (injectedCache) return injectedCache;
  if (rscHandlersByProject) return rscHandlersByProject;

  rscHandlersByProject = new LRUCache<string, RSCDevServerHandler>({
    maxEntries: RSC_HANDLERS_MAX_ENTRIES,
    ttlMs: RSC_HANDLERS_TTL_MS,
    cleanupIntervalMs: RSC_HANDLERS_CLEANUP_INTERVAL_MS,
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

export function __injectCacheForTests(
  cache: HandlerCache<RSCDevServerHandler> | null,
): void {
  injectedCache = cache;
}

export function __resetRSCHandlerForTests(): void {
  const cache = injectedCache ?? rscHandlersByProject;
  cache?.clear();
}

export function __destroyRSCHandlerForTests(): void {
  injectedCache = null;
  rscHandlersByProject?.destroy();
  rscHandlersByProject = null;
}
