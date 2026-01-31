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

export interface HandlerCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): boolean;
  clear(): void;
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
      serverLogger.debug("[resetApiHandler] Failed to destroy handler", error);
    } catch {
      // noop
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
