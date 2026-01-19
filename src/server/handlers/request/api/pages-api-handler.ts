/**
 * Pages Router API Handler
 *
 * Handles Pages Router API routes (under /api/ directory).
 */

import { APIRouteHandler } from "#veryfront/routing";
import { serverLogger } from "#veryfront/utils";
import type { HandlerContext } from "../../types.ts";

/**
 * API handler cache keyed by project directory and slug
 * In proxy mode: key = `${projectDir}:${projectSlug}` (each project gets its own handler)
 * In direct mode: key = `${projectDir}` (single project)
 */
const apiHandlerCache = new Map<string, Promise<APIRouteHandler>>();

async function destroyHandler(promise: Promise<APIRouteHandler> | undefined): Promise<void> {
  if (!promise) return;
  try {
    const handler = await promise;
    handler.destroy?.();
  } catch (error) {
    try {
      serverLogger.debug("[resetApiHandler] Failed to destroy handler", error);
    } catch {
      /* noop */
    }
  }
}

/**
 * Gets or initializes the API route handler for a specific project directory
 *
 * Uses lazy initialization and caching per project directory to avoid repeated initialization.
 *
 * @param ctx - Handler context containing project directory and adapter
 * @returns Initialized API route handler
 *
 * @example
 * ```ts
 * const handler = await getApiHandler(ctx);
 * const response = await handler.handle(request);
 * ```
 */
export async function getApiHandler(
  ctx: HandlerContext,
): Promise<APIRouteHandler> {
  // In proxy mode, projectDir is always '/app' but projectSlug varies per project
  // Include projectSlug in cache key to prevent cross-project route conflicts
  const key = ctx.projectSlug ? `${ctx.projectDir}:${ctx.projectSlug}` : ctx.projectDir;
  if (!apiHandlerCache.has(key)) {
    apiHandlerCache.set(
      key,
      (async () => {
        const h = new APIRouteHandler(ctx.projectDir, ctx.adapter);
        await h.initialize();
        return h;
      })(),
    );
  }
  return await apiHandlerCache.get(key)!;
}

/**
 * Resets the cached API handler(s)
 *
 * Used for testing or when the handler needs to be reinitialized.
 *
 * @param projectDir - Optional project directory to reset. If not provided, resets all.
 *
 * @example
 * ```ts
 * // Reset specific project
 * resetApiHandler('/path/to/project');
 *
 * // Reset all
 * resetApiHandler();
 * ```
 */
export async function resetApiHandler(projectDir?: string): Promise<void> {
  if (projectDir) {
    const cached = apiHandlerCache.get(projectDir);
    apiHandlerCache.delete(projectDir);
    await destroyHandler(cached);
    return;
  }

  const entries = Array.from(apiHandlerCache.values());
  apiHandlerCache.clear();
  await Promise.all(entries.map((promise) => destroyHandler(promise)));
}
