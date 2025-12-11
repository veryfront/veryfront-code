
import { APIRouteHandler } from "@veryfront/routing";
import { serverLogger } from "@veryfront/utils";
import type { HandlerContext } from "../../types.ts";

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
    }
  }
}

export async function getApiHandler(
  ctx: HandlerContext,
): Promise<APIRouteHandler> {
  const key = ctx.projectDir;
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
