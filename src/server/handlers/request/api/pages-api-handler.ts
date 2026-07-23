/** Pages Router API handler cache and lifecycle facade. */

import { APIRouteHandler } from "#veryfront/routing";
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";
import {
  extractCacheKeyContext,
  tryGetCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import type { HandlerContext } from "../../types.ts";
import { type HandlerCache, PagesApiHandlerCache } from "./pages-api-cache.ts";

export type { HandlerCache } from "./pages-api-cache.ts";
export { LRUHandlerCache } from "./pages-api-cache.ts";

async function refreshPreviewSourceSnapshot(ctx: HandlerContext): Promise<void> {
  if (!ctx.projectSlug) return;
  const cacheContext = tryGetCacheKeyContext() ?? extractCacheKeyContext(ctx);
  if (!cacheContext || cacheContext.mode === "production") return;
  await ctx.adapter.fs.refreshSourceSnapshot?.("preview-api-route-discovery");
}

async function createApiHandler(ctx: HandlerContext): Promise<APIRouteHandler> {
  await refreshPreviewSourceSnapshot(ctx);
  const handler = new APIRouteHandler(ctx.projectDir, ctx.adapter, ctx.config);
  await handler.initialize();
  return handler;
}

const apiHandlers = new PagesApiHandlerCache(createApiHandler);

export function __injectCacheForTests(
  cache: HandlerCache<Promise<APIRouteHandler>> | null,
): void {
  apiHandlers.inject(cache);
}

export function getApiHandler(ctx: HandlerContext): Promise<APIRouteHandler> {
  return apiHandlers.get(ctx);
}

/** Use a handler while deferring cache-eviction cleanup until the request finishes. */
export function withApiHandler<T>(
  ctx: HandlerContext,
  use: (handler: APIRouteHandler) => T | Promise<T>,
): Promise<T> {
  return apiHandlers.withHandler(ctx, use);
}

export function resetApiHandler(projectDir?: string): Promise<void> {
  return apiHandlers.resetByProjectDir(projectDir);
}

export function resetApiHandlerForProject(projectSlug: string): Promise<void> {
  return apiHandlers.resetByProjectSlug(projectSlug);
}

registerProcessStateReset("pages API handler", resetApiHandler);
