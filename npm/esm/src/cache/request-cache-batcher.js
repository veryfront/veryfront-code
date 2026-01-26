import * as dntShim from "../../_dnt.shims.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "../utils/index.js";
const asyncLocalStorage = new AsyncLocalStorage();
const BATCH_DELAY_MS = 1;
const MAX_BATCH_SIZE = 100;
export function runWithCacheBatching(fn) {
    const context = {
        cache: new Map(),
        pending: new Map(),
        batchQueue: [],
        batchTimer: null,
    };
    return asyncLocalStorage.run(context, async () => {
        try {
            return await fn();
        }
        finally {
            if (context.batchTimer)
                clearTimeout(context.batchTimer);
        }
    });
}
export function getRequestCacheContext() {
    return asyncLocalStorage.getStore();
}
export async function getCachedWithBatching(backend, key) {
    const ctx = asyncLocalStorage.getStore();
    if (!ctx)
        return backend.get(key);
    const cached = ctx.cache.get(key);
    if (cached !== undefined || ctx.cache.has(key))
        return cached ?? null;
    const existingPending = ctx.pending.get(key);
    if (existingPending)
        return existingPending;
    const promise = new Promise((resolve, reject) => {
        ctx.batchQueue.push({ key, resolve, reject });
        if (ctx.batchQueue.length >= MAX_BATCH_SIZE) {
            void flushBatch(ctx, backend);
            return;
        }
        if (ctx.batchTimer)
            return;
        ctx.batchTimer = dntShim.setTimeout(() => {
            ctx.batchTimer = null;
            void flushBatch(ctx, backend);
        }, BATCH_DELAY_MS);
    });
    ctx.pending.set(key, promise);
    try {
        const result = await promise;
        ctx.cache.set(key, result);
        return result;
    }
    finally {
        ctx.pending.delete(key);
    }
}
async function flushBatch(ctx, backend) {
    if (ctx.batchQueue.length === 0)
        return;
    const requests = ctx.batchQueue;
    ctx.batchQueue = [];
    if (ctx.batchTimer) {
        clearTimeout(ctx.batchTimer);
        ctx.batchTimer = null;
    }
    const uniqueKeys = [...new Set(requests.map((r) => r.key))];
    logger.debug("[RequestCacheBatcher] Flushing batch", {
        requested: requests.length,
        unique: uniqueKeys.length,
        dedupeRatio: (requests.length / uniqueKeys.length).toFixed(2),
    });
    try {
        const results = backend.getBatch && uniqueKeys.length > 1
            ? await backend.getBatch(uniqueKeys)
            : await getIndividually(backend, uniqueKeys);
        for (const request of requests) {
            const value = results.get(request.key) ?? null;
            ctx.cache.set(request.key, value);
            request.resolve(value);
        }
    }
    catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        for (const request of requests)
            request.reject(normalizedError);
    }
}
async function getIndividually(backend, keys) {
    const results = new Map();
    await Promise.all(keys.map(async (key) => {
        results.set(key, await backend.get(key));
    }));
    return results;
}
export function setInRequestCache(key, value) {
    asyncLocalStorage.getStore()?.cache.set(key, value);
}
export function getRequestCacheStats() {
    const ctx = asyncLocalStorage.getStore();
    if (!ctx)
        return null;
    return { hits: 0, stored: ctx.cache.size };
}
