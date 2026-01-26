import { registerCache } from "../../utils/memory/index.js";
import { logger } from "../../utils/logger/logger.js";
import { buildTransformCacheKey } from "../../cache/keys.js";
import { CacheBackends, MemoryCacheBackend } from "../../cache/backend.js";
const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const FALLBACK_MAX_ENTRIES = 500;
let cacheBackend = null;
let cacheInitialized = false;
let cacheInitPromise = null;
const localFallback = new Map();
registerCache("transform-cache", () => ({
    name: "transform-cache",
    entries: localFallback.size,
    maxEntries: FALLBACK_MAX_ENTRIES,
    backend: cacheBackend?.type ?? "uninitialized",
}));
export async function initializeTransformCache() {
    if (cacheInitialized) {
        return cacheBackend?.type !== "memory";
    }
    if (!cacheInitPromise) {
        cacheInitPromise = (async () => {
            try {
                cacheBackend = await CacheBackends.transform();
                logger.info("[TransformCache] Initialized", { backend: cacheBackend.type });
            }
            catch (error) {
                logger.warn("[TransformCache] Backend init failed, using memory", { error });
                cacheBackend = new MemoryCacheBackend(FALLBACK_MAX_ENTRIES);
            }
            finally {
                cacheInitialized = true;
            }
        })();
    }
    await cacheInitPromise;
    cacheInitPromise = null;
    return cacheBackend?.type !== "memory";
}
export function isDistributedCacheEnabled() {
    return cacheBackend?.type !== "memory" && cacheBackend !== null;
}
/** @deprecated Use initializeTransformCache instead */
export const initializeRedisCache = initializeTransformCache;
/** @deprecated Use isDistributedCacheEnabled instead */
export const isRedisCacheEnabled = isDistributedCacheEnabled;
export function generateCacheKey(filePath, contentHash, ssr = false, studioEmbed = false) {
    return buildTransformCacheKey(filePath, contentHash, ssr, studioEmbed);
}
export async function getCachedTransformAsync(key) {
    if (cacheBackend) {
        try {
            const raw = await cacheBackend.get(key);
            if (raw)
                return JSON.parse(raw);
        }
        catch (error) {
            logger.debug("[TransformCache] Backend get failed", { key, error });
        }
    }
    return localFallback.get(key);
}
export function getCachedTransform(key) {
    if (cacheBackend?.type !== "memory" && cacheBackend !== null)
        return undefined;
    return localFallback.get(key);
}
export async function setCachedTransformAsync(key, code, hash, ttlSeconds = DEFAULT_TTL_SECONDS) {
    const entry = { code, hash, timestamp: Date.now() };
    if (cacheBackend) {
        try {
            await cacheBackend.set(key, JSON.stringify(entry), normalizeTtl(ttlSeconds));
            return;
        }
        catch (error) {
            logger.debug("[TransformCache] Backend set failed", { key, error });
        }
    }
    setLocalFallback(key, entry);
}
export function setCachedTransform(key, code, hash, ttlSeconds = DEFAULT_TTL_SECONDS) {
    const entry = { code, hash, timestamp: Date.now() };
    if (!cacheBackend) {
        setLocalFallback(key, entry);
        return;
    }
    cacheBackend.set(key, JSON.stringify(entry), normalizeTtl(ttlSeconds)).catch((error) => {
        logger.debug("[TransformCache] Backend set failed", { key, error });
    });
    if (cacheBackend.type === "memory") {
        setLocalFallback(key, entry);
    }
}
function normalizeTtl(ttlSeconds) {
    return ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;
}
function setLocalFallback(key, entry) {
    localFallback.set(key, entry);
    if (localFallback.size > FALLBACK_MAX_ENTRIES)
        pruneLocalFallback();
}
function pruneLocalFallback() {
    const entries = Array.from(localFallback.entries()).sort(([, a], [, b]) => a.timestamp - b.timestamp);
    const excess = localFallback.size - FALLBACK_MAX_ENTRIES;
    for (let i = 0; i < excess; i++) {
        const [key] = entries[i];
        localFallback.delete(key);
    }
}
export function destroyTransformCache() {
    localFallback.clear();
}
export function getTransformCacheStats() {
    return {
        fallbackEntries: localFallback.size,
        maxFallbackEntries: FALLBACK_MAX_ENTRIES,
        backend: cacheBackend?.type ?? "uninitialized",
    };
}
