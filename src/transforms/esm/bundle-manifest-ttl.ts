import { buildBundleManifestCacheKey } from "#veryfront/cache/keys.ts";
import { CacheBackends, createDistributedCacheAccessor } from "#veryfront/cache/backend.ts";
import {
  BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC,
  BUNDLE_MANIFEST_LRU_MAX_ENTRIES,
} from "#veryfront/utils/constants/cache.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { rendererLogger as logger } from "#veryfront/utils";

const LOG_PREFIX = "[BundleManifest]";

/**
 * LRU mapping from bundle hash -> manifestId.
 * Used for TTL co-refresh: when any bundle is refreshed, also refresh its manifest.
 */
const hashToManifestId = new LRUCache<string, string>({
  maxEntries: BUNDLE_MANIFEST_LRU_MAX_ENTRIES,
});

/** Lazy accessor for the distributed cache backend. */
const getCache = createDistributedCacheAccessor(
  () => CacheBackends.httpModule(),
  "BUNDLE-MANIFEST",
);

export function rememberBundleManifestHashes(hashes: string[], manifestId: string): void {
  for (const hash of hashes) {
    hashToManifestId.set(hash, manifestId);
  }
}

/**
 * Get the manifest ID associated with a bundle hash (for TTL co-refresh).
 */
export function getManifestIdForHash(hash: string): string | undefined {
  return hashToManifestId.get(hash);
}

/**
 * Refresh the TTL of a manifest in the distributed cache.
 */
export async function refreshManifestTTL(manifestId: string): Promise<void> {
  const cache = await getCache();
  if (!cache) return;

  const key = buildBundleManifestCacheKey(manifestId);

  try {
    const raw = await cache.get(key);
    if (!raw) return;
    await cache.set(key, raw, BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC);
  } catch (error) {
    logger.debug(`${LOG_PREFIX} Failed to refresh manifest TTL`, {
      manifestId: manifestId.slice(0, 12),
      error,
    });
  }
}
