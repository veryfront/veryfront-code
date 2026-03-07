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

function getCacheKey(ctx: HandlerContext): string {
  return ctx.projectSlug ? `${ctx.projectDir}:${ctx.projectSlug}` : ctx.projectDir;
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
  const cache = getCache();
  const key = getCacheKey(ctx);

  let promise = cache.get(key);
  if (!promise) {
    promise = (async () => {
      const handler = new APIRouteHandler(ctx.projectDir, ctx.adapter);
      await handler.initialize();
      return handler;
    })();
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
 * In proxy/production mode the cache key is `"${projectDir}:${projectSlug}"`,
 * so we can't reuse `resetApiHandler(projectDir)`. Instead we iterate all
 * entries and destroy those whose key ends with `:${projectSlug}`.
 */
export async function resetApiHandlerForProject(
  projectSlug: string,
): Promise<void> {
  const cache = getCache();
  const suffix = `:${projectSlug}`;
  const toDestroy: Promise<APIRouteHandler>[] = [];

  for (const [key, promise] of cache.entries()) {
    if (key.endsWith(suffix) || key === projectSlug) {
      cache.delete(key);
      toDestroy.push(promise);
    }
  }

  await Promise.all(toDestroy.map(destroyHandler));
}
