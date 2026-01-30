/**
 * Bundle Manifest System
 *
 * Tracks HTTP bundles created during a transform as an atomic group.
 * Key invariant: a transform is never used unless ALL of its HTTP bundle
 * dependencies are confirmed present.
 *
 * @module transforms/esm/bundle-manifest
 */
import { rendererLogger as logger } from "../../utils/index.js";
import { computeHash } from "../../utils/hash-utils.js";
import { buildBundleManifestCacheKey } from "../../cache/keys.js";
import { BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC, BUNDLE_MANIFEST_LRU_MAX_ENTRIES, } from "../../utils/constants/cache.js";
import { LRUCache } from "../../utils/lru-wrapper.js";
import { CacheBackends, createDistributedCacheAccessor } from "../../cache/backend.js";
import { join } from "../../platform/compat/path/index.js";
import { exists } from "../../platform/compat/fs.js";
import { ensureHttpBundlesExist } from "./http-cache.js";
const LOG_PREFIX = "[BundleManifest]";
/**
 * LRU mapping from bundle hash → manifestId.
 * Used for TTL co-refresh: when any bundle is refreshed, also refresh its manifest.
 */
const hashToManifestId = new LRUCache({
    maxEntries: BUNDLE_MANIFEST_LRU_MAX_ENTRIES,
});
/** Lazy accessor for the distributed cache backend. */
const getCache = createDistributedCacheAccessor(() => CacheBackends.httpModule(), "BUNDLE-MANIFEST");
/**
 * Compute a deterministic manifest ID from bundle hashes.
 * Sorts hashes to ensure the same set of bundles always produces the same ID.
 */
export async function computeManifestId(hashes) {
    const sorted = [...hashes].sort();
    const input = sorted.join(":");
    return await computeHash(input);
}
/**
 * Create a bundle manifest from collected bundle metadata.
 */
export async function createBundleManifest(bundles) {
    const hashes = bundles.map((b) => b.hash);
    const manifestId = await computeManifestId(hashes);
    const manifest = {
        manifestId,
        bundles,
        createdAt: Date.now(),
        ttlSeconds: BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC,
    };
    // Register hash→manifestId mappings for co-refresh
    for (const hash of hashes) {
        hashToManifestId.set(hash, manifestId);
    }
    return manifest;
}
/**
 * Store a bundle manifest in the distributed cache.
 */
export async function storeBundleManifest(manifest) {
    const cache = await getCache();
    if (!cache) {
        logger.debug(`${LOG_PREFIX} No distributed cache available, skipping manifest store`);
        return;
    }
    const key = buildBundleManifestCacheKey(manifest.manifestId);
    try {
        await cache.set(key, JSON.stringify(manifest), manifest.ttlSeconds);
        logger.debug(`${LOG_PREFIX} Stored manifest`, {
            manifestId: manifest.manifestId.slice(0, 12),
            bundleCount: manifest.bundles.length,
        });
    }
    catch (error) {
        logger.warn(`${LOG_PREFIX} Failed to store manifest`, {
            manifestId: manifest.manifestId.slice(0, 12),
            error,
        });
    }
}
/**
 * Load a bundle manifest from the distributed cache.
 */
export async function loadBundleManifest(manifestId) {
    const cache = await getCache();
    if (!cache)
        return null;
    const key = buildBundleManifestCacheKey(manifestId);
    try {
        const raw = await cache.get(key);
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch (error) {
        logger.debug(`${LOG_PREFIX} Failed to load manifest`, {
            manifestId: manifestId.slice(0, 12),
            error,
        });
        return null;
    }
}
/**
 * Validate that ALL bundles in a manifest group exist on the local filesystem.
 * If bundles are missing, attempts to recover them from distributed cache.
 *
 * This is the core safety check: if any bundle is missing after recovery attempts,
 * the transform should be re-computed rather than returning a 500 error.
 */
export async function validateBundleGroup(manifestId, cacheDir) {
    const manifest = await loadBundleManifest(manifestId);
    if (!manifest) {
        logger.debug(`${LOG_PREFIX} Manifest not found in distributed cache`, {
            manifestId: manifestId.slice(0, 12),
        });
        return { valid: false, failedHashes: [] };
    }
    // First pass: check which bundles are missing locally
    const missingBundles = [];
    await Promise.all(manifest.bundles.map(async (bundle) => {
        const bundlePath = join(cacheDir, `http-${bundle.hash}.mjs`);
        const fileExists = await exists(bundlePath);
        if (!fileExists) {
            missingBundles.push({ path: bundlePath, hash: bundle.hash });
        }
    }));
    // If bundles are missing, try to recover them from distributed cache
    if (missingBundles.length > 0) {
        logger.info(`${LOG_PREFIX} Attempting to recover missing bundles`, {
            manifestId: manifestId.slice(0, 12),
            missing: missingBundles.length,
            total: manifest.bundles.length,
        });
        const unrecoverableHashes = await ensureHttpBundlesExist(missingBundles, cacheDir);
        if (unrecoverableHashes.length > 0) {
            logger.warn(`${LOG_PREFIX} Some bundles could not be recovered`, {
                manifestId: manifestId.slice(0, 12),
                unrecoverable: unrecoverableHashes,
            });
            return { valid: false, failedHashes: unrecoverableHashes };
        }
        logger.info(`${LOG_PREFIX} All missing bundles recovered successfully`, {
            manifestId: manifestId.slice(0, 12),
            recovered: missingBundles.length,
        });
    }
    return { valid: true, failedHashes: [] };
}
/**
 * Get the manifest ID associated with a bundle hash (for TTL co-refresh).
 */
export function getManifestIdForHash(hash) {
    return hashToManifestId.get(hash);
}
/**
 * Refresh the TTL of a manifest in the distributed cache.
 */
export async function refreshManifestTTL(manifestId) {
    const cache = await getCache();
    if (!cache)
        return;
    const key = buildBundleManifestCacheKey(manifestId);
    try {
        const raw = await cache.get(key);
        if (raw) {
            await cache.set(key, raw, BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC);
        }
    }
    catch (error) {
        logger.debug(`${LOG_PREFIX} Failed to refresh manifest TTL`, {
            manifestId: manifestId.slice(0, 12),
            error,
        });
    }
}
