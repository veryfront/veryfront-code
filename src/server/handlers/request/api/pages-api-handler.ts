/**
 * Pages Router API Handler
 *
 * Handles Pages Router API routes (under /api/ directory).
 * Supports optional cache injection for testing.
 *
 * @module server/handlers/request/api/pages-api-handler
 */

import { APIRouteHandler } from "#veryfront/routing";
import { serverLogger } from "#veryfront/utils";
import {
  extractCacheKeyContext,
  tryGetCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import type { HandlerContext } from "../../types.ts";

const logger = serverLogger.component("reset-api-handler");

export interface HandlerCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): boolean;
  clear(): void;
  entries(): IterableIterator<[string, T]>;
  values(): IterableIterator<T>;
}

const apiHandlerCache = new Map<string, Promise<APIRouteHandler>>();
let injectedCache: HandlerCache<Promise<APIRouteHandler>> | null = null;

function getCache(): HandlerCache<Promise<APIRouteHandler>> {
  return injectedCache ?? apiHandlerCache;
}

export function __injectCacheForTests(
  cache: HandlerCache<Promise<APIRouteHandler>> | null,
): void {
  injectedCache = cache;
}

function getApiHandlerCacheContext(ctx: HandlerContext) {
  return tryGetCacheKeyContext() ?? extractCacheKeyContext(ctx);
}

function getCacheKey(ctx: HandlerContext): string {
  if (!ctx.projectSlug) return ctx.projectDir;

  const cacheContext = getApiHandlerCacheContext(ctx);
  return `${ctx.projectDir}:${ctx.projectSlug}:${cacheContext.mode}:${cacheContext.versionId}`;
}

function shouldCacheApiHandler(ctx: HandlerContext): boolean {
  if (!ctx.projectSlug) return true;

  return getApiHandlerCacheContext(ctx).mode === "production";
}

async function refreshPreviewSourceSnapshot(ctx: HandlerContext): Promise<void> {
  if (!ctx.projectSlug) return;
  if (getApiHandlerCacheContext(ctx).mode === "production") return;

  await ctx.adapter.fs.refreshSourceSnapshot?.("preview-api-route-discovery");
}

async function createApiHandler(ctx: HandlerContext): Promise<APIRouteHandler> {
  await refreshPreviewSourceSnapshot(ctx);

  const handler = new APIRouteHandler(ctx.projectDir, ctx.adapter);
  await handler.initialize();
  return handler;
}

async function destroyHandler(promise?: Promise<APIRouteHandler>): Promise<void> {
  if (!promise) return;

  try {
    const handler = await promise;
    handler.destroy?.();
  } catch (error) {
    try {
      logger.debug("Failed to destroy handler", error);
    } catch (_) {
      // expected: logger itself may throw during shutdown
    }
  }
}

export async function getApiHandler(ctx: HandlerContext): Promise<APIRouteHandler> {
  if (!shouldCacheApiHandler(ctx)) return createApiHandler(ctx);

  const cache = getCache();
  const key = getCacheKey(ctx);

  let promise = cache.get(key);
  if (!promise) {
    promise = createApiHandler(ctx);
    cache.set(key, promise);
  }

  return promise;
}

export async function resetApiHandler(projectDir?: string): Promise<void> {
  const cache = getCache();

  if (projectDir) {
    const cached = cache.get(projectDir);
    cache.delete(projectDir);
    await destroyHandler(cached);
    return;
  }

  const handlers = Array.from(cache.values());
  cache.clear();
  await Promise.all(handlers.map(destroyHandler));
}

/**
 * Reset cached API handlers for a specific project slug.
 *
 * In proxy/production mode the cache key includes the project slug and release
 * context, so we can't reuse `resetApiHandler(projectDir)`. Instead we iterate
 * all entries and destroy those scoped to the project slug.
 */
export async function resetApiHandlerForProject(
  projectSlug: string,
): Promise<void> {
  const cache = getCache();
  const toDestroy: Promise<APIRouteHandler>[] = [];

  for (const [key, promise] of cache.entries()) {
    if (
      key === projectSlug || key.endsWith(`:${projectSlug}`) || key.includes(`:${projectSlug}:`)
    ) {
      cache.delete(key);
      toDestroy.push(promise);
    }
  }

  await Promise.all(toDestroy.map(destroyHandler));
}
