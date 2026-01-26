import * as dntShim from "../../_dnt.shims.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
let _getCurrentRequestContext;
const CacheKeyContextSchema = z.object({
    projectId: z.string().min(1, "projectId cannot be empty"),
    mode: z.enum(["production", "preview"]),
    versionId: z.string().min(1, "versionId cannot be empty"),
});
const cacheKeyContextStorage = new AsyncLocalStorage();
function validateCacheKeyContext(ctx) {
    return CacheKeyContextSchema.parse(ctx);
}
export function getContentHashKey(prefix, filePath, contentHash, suffix) {
    const base = `${prefix}:${filePath}:${contentHash}`;
    return suffix ? `${base}:${suffix}` : base;
}
export function runWithCacheKeyContext(ctx, fn) {
    return cacheKeyContextStorage.run(validateCacheKeyContext(ctx), fn);
}
export function getCurrentCacheKeyContext() {
    const ctx = cacheKeyContextStorage.getStore();
    if (ctx)
        return ctx;
    throw new Error("[CacheKeyBuilder] No cache context available. " +
        "Ensure runWithCacheKeyContext() was called at request entry.");
}
function getRequestContextFn() {
    if (_getCurrentRequestContext !== undefined)
        return _getCurrentRequestContext ?? null;
    try {
        // deno-lint-ignore no-explicit-any
        const mod = dntShim.dntGlobalThis.__vf_multi_project_adapter;
        _getCurrentRequestContext = mod?.getCurrentRequestContext ?? null;
    }
    catch {
        _getCurrentRequestContext = null;
    }
    return _getCurrentRequestContext ?? null;
}
function extractCacheKeyContextFromMultiProjectContext(reqCtx) {
    const projectId = reqCtx.projectId || reqCtx.projectSlug || "default";
    const mode = reqCtx.productionMode ? "production" : "preview";
    const versionId = reqCtx.productionMode
        ? (reqCtx.releaseId || "latest")
        : (reqCtx.branch || "main");
    return { projectId, mode, versionId };
}
export function tryGetCacheKeyContext() {
    const explicitCtx = cacheKeyContextStorage.getStore();
    if (explicitCtx)
        return explicitCtx;
    const getReqCtx = getRequestContextFn();
    const reqCtx = getReqCtx?.();
    if (!reqCtx)
        return null;
    return extractCacheKeyContextFromMultiProjectContext(reqCtx);
}
export function getProjectScopedKey(prefix, resourceKey) {
    const ctx = tryGetCacheKeyContext();
    if (!ctx || ctx.mode === "preview")
        return null;
    return `${prefix}:${ctx.projectId}:${ctx.mode}:${ctx.versionId}:${resourceKey}`;
}
export function getProjectScopedKeyAlways(prefix, resourceKey) {
    const ctx = tryGetCacheKeyContext();
    if (!ctx)
        return null;
    return `${prefix}:${ctx.projectId}:${ctx.mode}:${ctx.versionId}:${resourceKey}`;
}
export function extractCacheKeyContext(handlerCtx) {
    const projectId = handlerCtx.projectId || handlerCtx.projectSlug || "default";
    const mode = handlerCtx.resolvedEnvironment ?? handlerCtx.requestContext?.mode ?? "preview";
    const versionId = mode === "production"
        ? (handlerCtx.releaseId || "latest")
        : (handlerCtx.parsedDomain?.branch || "main");
    return { projectId, mode, versionId };
}
/**
 * @deprecated Use tryGetCacheKeyContext() which auto-detects context
 */
export function extractCacheKeyContextFromRequestContext(reqCtx) {
    return extractCacheKeyContextFromMultiProjectContext(reqCtx);
}
