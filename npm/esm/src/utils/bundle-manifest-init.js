import { serverLogger as logger } from "./logger/index.js";
import { InMemoryBundleManifestStore, setBundleManifestStore, } from "./bundle-manifest.js";
import { BUNDLE_MANIFEST_DEV_TTL_MS, BUNDLE_MANIFEST_PROD_TTL_MS } from "./constants/cache.js";
export async function initializeBundleManifest(config, mode, adapter) {
    const manifestConfig = config.cache?.bundleManifest;
    const enabled = manifestConfig?.enabled ?? mode === "production";
    if (!enabled) {
        logger.info("[bundle-manifest] Bundle manifest disabled");
        setBundleManifestStore(new InMemoryBundleManifestStore());
        return;
    }
    const storeType = manifestConfig?.type ?? adapter?.env.get("VERYFRONT_BUNDLE_MANIFEST_TYPE") ??
        "memory";
    logger.info("[bundle-manifest] Initializing bundle manifest", { type: storeType, mode });
    try {
        const store = await createStore(storeType, config.cache, adapter);
        setBundleManifestStore(store);
        try {
            const stats = await store.getStats();
            logger.info("[bundle-manifest] Store statistics", stats);
        }
        catch (error) {
            logger.debug("[bundle-manifest] Failed to get stats", { error });
        }
    }
    catch (error) {
        logger.error("[bundle-manifest] Failed to initialize store, using in-memory fallback", {
            error,
        });
        setBundleManifestStore(new InMemoryBundleManifestStore());
    }
}
async function createStore(storeType, manifestConfig, adapter) {
    if (storeType === "redis") {
        const { RedisBundleManifestStore } = await import("./bundle-manifest-redis.js");
        const bundleManifest = manifestConfig?.bundleManifest;
        const redisUrl = bundleManifest?.redisUrl ??
            adapter?.env.get("VERYFRONT_BUNDLE_MANIFEST_REDIS_URL");
        const store = new RedisBundleManifestStore({
            url: redisUrl,
            keyPrefix: bundleManifest?.keyPrefix,
        }, adapter);
        const available = await store.isAvailable();
        if (!available) {
            logger.warn("[bundle-manifest] Redis not available, falling back to in-memory");
            return new InMemoryBundleManifestStore();
        }
        logger.info("[bundle-manifest] Redis store initialized");
        return store;
    }
    if (storeType === "kv") {
        const { KVBundleManifestStore } = await import("./bundle-manifest-kv.js");
        const store = new KVBundleManifestStore({
            keyPrefix: manifestConfig?.bundleManifest?.keyPrefix,
        });
        const available = await store.isAvailable();
        if (!available) {
            logger.warn("[bundle-manifest] KV not available, falling back to in-memory");
            return new InMemoryBundleManifestStore();
        }
        logger.info("[bundle-manifest] KV store initialized");
        return store;
    }
    logger.info("[bundle-manifest] In-memory store initialized");
    return new InMemoryBundleManifestStore();
}
export function getBundleManifestTTL(config, mode) {
    const ttl = config.cache?.bundleManifest?.ttl;
    if (ttl)
        return ttl;
    return mode === "production" ? BUNDLE_MANIFEST_PROD_TTL_MS : BUNDLE_MANIFEST_DEV_TTL_MS;
}
export async function warmupBundleManifest(store, keys) {
    logger.info("[bundle-manifest] Warming up cache", { keys: keys.length });
    let loaded = 0;
    let failed = 0;
    for (const key of keys) {
        try {
            const metadata = await store.getBundleMetadata(key);
            if (!metadata)
                continue;
            await store.getBundleCode(metadata.codeHash);
            loaded++;
        }
        catch (error) {
            logger.debug("[bundle-manifest] Failed to warm up key", { key, error });
            failed++;
        }
    }
    logger.info("[bundle-manifest] Cache warmup complete", { loaded, failed });
}
