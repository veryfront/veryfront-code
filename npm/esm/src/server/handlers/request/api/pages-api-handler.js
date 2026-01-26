/****
 * Pages Router API Handler
 *
 * Handles Pages Router API routes (under /api/ directory).
 */
import { APIRouteHandler } from "../../../../routing/index.js";
import { serverLogger } from "../../../../utils/index.js";
const apiHandlerCache = new Map();
function getCacheKey(ctx) {
    return ctx.projectSlug ? `${ctx.projectDir}:${ctx.projectSlug}` : ctx.projectDir;
}
async function destroyHandler(promise) {
    if (!promise)
        return;
    try {
        const handler = await promise;
        handler.destroy?.();
    }
    catch (error) {
        try {
            serverLogger.debug("[resetApiHandler] Failed to destroy handler", error);
        }
        catch {
            // noop
        }
    }
}
export async function getApiHandler(ctx) {
    const key = getCacheKey(ctx);
    let promise = apiHandlerCache.get(key);
    if (!promise) {
        promise = (async () => {
            const handler = new APIRouteHandler(ctx.projectDir, ctx.adapter);
            await handler.initialize();
            return handler;
        })();
        apiHandlerCache.set(key, promise);
    }
    return await promise;
}
export async function resetApiHandler(projectDir) {
    if (projectDir) {
        const cached = apiHandlerCache.get(projectDir);
        apiHandlerCache.delete(projectDir);
        await destroyHandler(cached);
        return;
    }
    const handlers = Array.from(apiHandlerCache.values());
    apiHandlerCache.clear();
    await Promise.all(handlers.map(destroyHandler));
}
