/**************************
 * Bundle Manifest System
 *
 * Tracks HTTP bundles created during a transform as an atomic group.
 * Key invariant: a transform is never used unless ALL of its HTTP bundle
 * dependencies are confirmed present.
 *
 * @module transforms/esm/bundle-manifest
 **************************/

import { rendererLogger as logger } from "#veryfront/utils";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { buildBundleManifestCacheKey } from "../../cache/keys.ts";
import {
  BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC,
  BUNDLE_MANIFEST_LRU_MAX_ENTRIES,
} from "#veryfront/utils/constants/cache.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { CacheBackends, createDistributedCacheAccessor } from "../../cache/backend.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";
import { ensureHttpBundlesExist } from "./http-cache.ts";

const LOG_PREFIX = "[BundleManifest]";

/** A single HTTP bundle entry in a manifest. */
export interface BundleEntry {
  hash: string;
  url: string;
  sizeBytes: number;
}

/** A manifest tracking all HTTP bundles from a single transform. */
export interface BundleManifest {
  manifestId: string;
  bundles: BundleEntry[];
  createdAt: number;
  ttlSeconds: number;
}

/** Result of manifest validation. */
export interface ManifestValidationResult {
  valid: boolean;
  failedHashes: string[];
}

/**
 * LRU mapping from bundle hash → manifestId.
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

/**
 * Compute a deterministic manifest ID from bundle hashes.
 * Sorts hashes to ensure the same set of bundles always produces the same ID.
 */
export async function computeManifestId(hashes: string[]): Promise<string> {
  return computeHash([...hashes].sort().join(":"));
}

/**
 * Create a bundle manifest from collected bundle metadata.
 */
export async function createBundleManifest(bundles: BundleEntry[]): Promise<BundleManifest> {
  const hashes = bundles.map((b) => b.hash);
  const manifestId = await computeManifestId(hashes);

  for (const hash of hashes) {
    hashToManifestId.set(hash, manifestId);
  }

  return {
    manifestId,
    bundles,
    createdAt: Date.now(),
    ttlSeconds: BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC,
  };
}

/**
 * Store a bundle manifest in the distributed cache.
 */
export async function storeBundleManifest(manifest: BundleManifest): Promise<void> {
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
  } catch (error) {
    logger.warn(`${LOG_PREFIX} Failed to store manifest`, {
      manifestId: manifest.manifestId.slice(0, 12),
      error,
    });
  }
}

/**
 * Load a bundle manifest from the distributed cache.
 */
export async function loadBundleManifest(manifestId: string): Promise<BundleManifest | null> {
  const cache = await getCache();
  if (!cache) return null;

  const key = buildBundleManifestCacheKey(manifestId);

  try {
    const raw = await cache.get(key);
    return raw ? (JSON.parse(raw) as BundleManifest) : null;
  } catch (error) {
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
export async function validateBundleGroup(
  manifestId: string,
  cacheDir: string,
): Promise<ManifestValidationResult> {
  const manifest = await loadBundleManifest(manifestId);
  if (!manifest) {
    logger.debug(`${LOG_PREFIX} Manifest not found in distributed cache`, {
      manifestId: manifestId.slice(0, 12),
    });
    return { valid: false, failedHashes: [] };
  }

  const missingBundles: Array<{ path: string; hash: string }> = [];

  await Promise.all(
    manifest.bundles.map(async ({ hash }) => {
      const path = join(cacheDir, `http-${hash}.mjs`);
      if (!(await exists(path))) missingBundles.push({ path, hash });
    }),
  );

  if (missingBundles.length === 0) return { valid: true, failedHashes: [] };

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

  return { valid: true, failedHashes: [] };
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
