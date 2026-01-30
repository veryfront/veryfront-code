import { registerCache } from "../../utils/memory/index.js";
import { logger } from "../../utils/logger/logger.js";
import { buildTransformCacheKey } from "../../cache/keys.js";
import { CacheBackends, MemoryCacheBackend } from "../../cache/backend.js";
import { hashCodeHex } from "../../utils/hash-utils.js";
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
export function generateCacheKey(filePath, contentHash, ssr = false, studioEmbed = false, options) {
    return buildTransformCacheKey(filePath, contentHash, ssr, studioEmbed, options);
}
export async function getCachedTransformAsync(key) {
    if (cacheBackend) {
        try {
            const raw = await cacheBackend.get(key);
            if (raw) {
                const entry = JSON.parse(raw);
                if (!entry.code) {
                    logger.warn("[TransformCache] Cache entry has empty code, discarding", { key });
                    return undefined;
                }
                return entry;
            }
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
export async function setCachedTransformAsync(key, code, hash, ttlSeconds = DEFAULT_TTL_SECONDS, bundleManifestId) {
    const entry = { code, hash, timestamp: Date.now(), bundleManifestId };
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
/**
 * Get the underlying distributed cache backend.
 *
 * This is exposed for callers that need direct access to the distributed
 * cache (e.g., MDX module-fetcher that stores raw code strings instead of
 * TransformCacheEntry JSON). Ensures initialization happens only once.
 *
 * Returns null if distributed cache is not available (memory-only mode).
 */
export async function getDistributedTransformBackend() {
    await initializeTransformCache();
    if (!cacheBackend || cacheBackend.type === "memory")
        return null;
    return cacheBackend;
}
/**
 * Get a cached transform or compute it if not found.
 *
 * This is the preferred way to use the transform cache - it handles:
 * - Cache lookup (distributed first, then local fallback)
 * - Compute on miss
 * - Cache storage on compute
 *
 * @param key - Cache key (use generateCacheKey to build it)
 * @param computeFn - Function to compute the transform if not cached
 * @param ttlSeconds - TTL for the cached entry
 * @returns The cached or computed code
 */
export async function getOrComputeTransform(key, computeFn, ttlSeconds = DEFAULT_TTL_SECONDS) {
    // Try to get from cache first
    const cached = await getCachedTransformAsync(key);
    if (cached) {
        logger.debug("[TransformCache] Cache hit", { key });
        return { code: cached.code, bundleManifestId: cached.bundleManifestId, cacheHit: true };
    }
    // Compute on miss
    logger.debug("[TransformCache] Cache miss, computing", { key });
    const code = await computeFn();
    // Store in cache (fire-and-forget for performance)
    // Use proper content hash for integrity verification
    const hash = hashCodeHex(code).slice(0, 16);
    setCachedTransformAsync(key, code, hash, ttlSeconds).catch((error) => {
        logger.debug("[TransformCache] Failed to cache computed transform", { key, error });
    });
    return { code, cacheHit: false };
}
export function getTransformCacheStats() {
    return {
        fallbackEntries: localFallback.size,
        maxFallbackEntries: FALLBACK_MAX_ENTRIES,
        backend: cacheBackend?.type ?? "uninitialized",
    };
}
/**
 * Warm up the transform cache with pre-computed entries.
 *
 * This function is designed to be called during deployment to pre-populate
 * the distributed cache, reducing P99 latency for cold starts. Each pod that
 * starts will have immediate access to cached transforms.
 *
 * @param entries - Array of transform entries to warm up
 * @param ttlSeconds - TTL for the cached entries (default: 1 hour for warmup)
 * @returns Summary of warmup results
 */
export async function warmupTransformCache(entries, ttlSeconds = 3600) {
    const start = performance.now();
    let success = 0;
    let failed = 0;
    let skipped = 0;
    // Ensure cache is initialized
    await initializeTransformCache();
    // Check if distributed cache is available
    const isDistributed = isDistributedCacheEnabled();
    if (!isDistributed) {
        logger.warn("[TransformCache] Warmup skipped - no distributed cache available");
        return {
            success: 0,
            failed: 0,
            skipped: entries.length,
            durationMs: Math.round(performance.now() - start),
        };
    }
    // Process entries in batches to avoid overwhelming the cache backend
    const BATCH_SIZE = 50;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(batch.map(async (entry) => {
            // Check if already cached
            const existing = await getCachedTransformAsync(entry.key);
            if (existing && existing.hash === entry.hash) {
                skipped++;
                return;
            }
            await setCachedTransformAsync(entry.key, entry.code, entry.hash, ttlSeconds, entry.bundleManifestId);
            success++;
        }));
        // Count failures
        for (const result of results) {
            if (result.status === "rejected") {
                failed++;
                logger.debug("[TransformCache] Warmup entry failed", {
                    error: result.reason,
                });
            }
        }
    }
    const durationMs = Math.round(performance.now() - start);
    logger.info("[TransformCache] Warmup complete", {
        success,
        failed,
        skipped,
        total: entries.length,
        durationMs,
        backend: cacheBackend?.type,
    });
    return { success, failed, skipped, durationMs };
}
/**
 * Pre-warm the cache for a specific project by fetching known hot paths.
 *
 * This is a convenience function that can be called during pod startup
 * to ensure commonly-accessed transforms are cached locally.
 *
 * @param projectId - The project ID to warm up
 * @param filePaths - Array of file paths to warm up
 * @returns Number of entries pre-warmed
 */
export async function prewarmProjectTransforms(projectId, filePaths) {
    await initializeTransformCache();
    if (!cacheBackend || cacheBackend.type === "memory") {
        logger.debug("[TransformCache] Prewarm skipped - no distributed cache");
        return 0;
    }
    let prewarmed = 0;
    for (const filePath of filePaths) {
        // Check distributed cache and copy to local if found
        // This brings entries into local memory for faster access
        try {
            // We don't know the exact cache key without content hash, but we can
            // use pattern matching if the backend supports it
            const pattern = `v*:${projectId}:${filePath}:*:ssr`;
            if (typeof cacheBackend.scan === "function") {
                const keys = await cacheBackend.scan(pattern, 10);
                for (const key of keys) {
                    const cached = await getCachedTransformAsync(key);
                    if (cached) {
                        // Use setLocalFallback to respect size limits and prevent memory leaks
                        setLocalFallback(key, cached);
                        prewarmed++;
                    }
                }
            }
        }
        catch (error) {
            logger.debug("[TransformCache] Prewarm failed for path", { projectId, filePath, error });
        }
    }
    logger.debug("[TransformCache] Prewarm complete", {
        projectId,
        prewarmed,
        total: filePaths.length,
    });
    return prewarmed;
}
