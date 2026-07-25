/**
 * RSC handler registry for managing per-project handlers
 *
 * Supports optional cache injection for testing.
 *
 * @module rsc-endpoints/handler-registry
 */

import { RSCDevServerHandler } from "../orchestrators/index.ts";
import {
  getConfiguredRSCReactVersion,
  type RSCServerHandlerOptions,
} from "../orchestrators/handler.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { assertImportMapIdentity } from "#veryfront/modules/import-map/index.ts";

const RSC_HANDLERS_MAX_ENTRIES = 50;
const RSC_HANDLERS_TTL_MS = 60 * 60 * 1000; // 1 hour
const RSC_HANDLERS_CLEANUP_INTERVAL_MS = 300_000; // 5 minutes
// API routes can execute project code in the shared realm when worker
// isolation is unavailable or disabled. Capture the cache-key codecs before
// that code can replace ambient primordials and make invalidation miss entries.
const arrayIsArray = Array.isArray;
const jsonParse = JSON.parse;
const jsonStringify = JSON.stringify;

/**
 * Handler cache interface for dependency injection.
 * Simplified interface that matches LRUCache's essential methods.
 */
export interface HandlerCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): boolean;
  clear(): void;
  keys(): IterableIterator<string>;
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

function getExistingHandlersCache(): HandlerCache<RSCDevServerHandler> | null {
  return injectedCache ?? rscHandlersByProject;
}

function cacheKeyBelongsToProject(cacheKey: string, projectKey: string): boolean {
  try {
    const cacheKeyParts: unknown = jsonParse(cacheKey);
    return arrayIsArray(cacheKeyParts) && cacheKeyParts[0] === projectKey;
  } catch {
    return false;
  }
}

export function getRSCHandler(
  projectDir: string,
  projectId?: string,
  options: RSCServerHandlerOptions = {},
): RSCDevServerHandler {
  if (options.importMapIdentity) {
    assertImportMapIdentity(options.importMapIdentity);
  }
  // A synchronous standalone caller cannot derive the exact merged
  // deno.json/config fingerprint here. Keep serving it, but do not cache a
  // closure over mutable import-map configuration under an incomplete key.
  if (
    options.config?.resolve?.importMap !== undefined &&
    options.importMapIdentity === undefined
  ) {
    return new RSCDevServerHandler(projectDir, options);
  }
  const baseKey = projectId ?? projectDir;
  const appDir = options.config?.directories?.app ?? "app";
  const mode = options.mode ?? "production";
  const reactVersion = getConfiguredRSCReactVersion(options.config) ?? null;
  const cacheKey = jsonStringify([
    baseKey,
    options.isLocalProject === true,
    mode,
    appDir,
    reactVersion,
    ...(options.contentSourceId || options.releaseId
      ? [options.releaseId ?? null, options.contentSourceId ?? null]
      : []),
    ...(options.importMapIdentity ? [options.importMapIdentity.fingerprint] : []),
  ]);
  const cache = getHandlersCache();
  const existing = cache.get(cacheKey);
  if (existing) return existing;

  const handler = new RSCDevServerHandler(projectDir, options);
  cache.set(cacheKey, handler);
  return handler;
}

export function invalidateRSCHandlersForProject(
  projectDir: string,
  projectId?: string,
): void {
  const projectKey = projectId ?? projectDir;
  const cache = getExistingHandlersCache();
  if (!cache) return;

  // The handler cache is deliberately small, so scanning its authoritative
  // live-key view is bounded. This also avoids retaining a second index after
  // capacity eviction or TTL expiry.
  for (const cacheKey of [...cache.keys()]) {
    if (cacheKeyBelongsToProject(cacheKey, projectKey)) cache.delete(cacheKey);
  }
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
