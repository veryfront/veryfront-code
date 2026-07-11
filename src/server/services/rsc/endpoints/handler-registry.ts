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
  delete(key: string): boolean;
  clear(): void;
  readonly size: number;
}

let rscHandlersByProject: LRUCache<string, RSCDevServerHandler> | null = null;
let cacheRegistered = false;

/** Injected cache for testing (overrides default LRUCache) */
let injectedCache: HandlerCache<RSCDevServerHandler> | null = null;
const handlerKeysByProject = new Map<string, Set<string>>();

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

export function getRSCHandler(
  projectDir: string,
  projectId?: string,
  options: RSCServerHandlerOptions = {},
): RSCDevServerHandler {
  const baseKey = projectId ?? projectDir;
  const appDir = options.config?.directories?.app ?? "app";
  const mode = options.mode ?? "production";
  const reactVersion = getConfiguredRSCReactVersion(options.config) ?? null;
  const cacheKey = JSON.stringify([
    baseKey,
    options.isLocalProject === true,
    mode,
    appDir,
    reactVersion,
    ...(options.contentSourceId || options.releaseId
      ? [options.releaseId ?? null, options.contentSourceId ?? null]
      : []),
  ]);
  const cache = getHandlersCache();
  const existing = cache.get(cacheKey);
  if (existing) return existing;

  const handler = new RSCDevServerHandler(projectDir, options);
  cache.set(cacheKey, handler);
  const projectKeys = handlerKeysByProject.get(baseKey) ?? new Set<string>();
  projectKeys.add(cacheKey);
  handlerKeysByProject.set(baseKey, projectKeys);
  return handler;
}

export function invalidateRSCHandlersForProject(
  projectDir: string,
  projectId?: string,
): void {
  const projectKey = projectId ?? projectDir;
  const cacheKeys = handlerKeysByProject.get(projectKey);
  if (!cacheKeys) return;

  const cache = getHandlersCache();
  for (const cacheKey of cacheKeys) cache.delete(cacheKey);
  handlerKeysByProject.delete(projectKey);
}

export function __injectCacheForTests(
  cache: HandlerCache<RSCDevServerHandler> | null,
): void {
  injectedCache = cache;
}

export function __resetRSCHandlerForTests(): void {
  const cache = injectedCache ?? rscHandlersByProject;
  cache?.clear();
  handlerKeysByProject.clear();
}

export function __destroyRSCHandlerForTests(): void {
  injectedCache = null;
  rscHandlersByProject?.destroy();
  rscHandlersByProject = null;
  handlerKeysByProject.clear();
}
