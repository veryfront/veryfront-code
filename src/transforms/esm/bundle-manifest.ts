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
import { buildBundleManifestCacheKey } from "#veryfront/cache/keys.ts";
import { BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { CacheBackends, createDistributedCacheAccessor } from "#veryfront/cache/backend.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { rememberBundleManifestHashes } from "./bundle-manifest-ttl.ts";
import type { BundleEntry, BundleManifest } from "./bundle-manifest-types.ts";
import { validateBundleDepsExist } from "./bundle-deps-validator.ts";
import {
  isValidHttpBundleHash,
  MAX_CACHED_HTTP_BUNDLE_BYTES,
  MAX_HTTP_BUNDLE_GRAPH_ENTRIES,
} from "./http-bundle-file.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
export type { BundleEntry, BundleManifest } from "./bundle-manifest-types.ts";
export { getManifestIdForHash, refreshManifestTTL } from "./bundle-manifest-ttl.ts";

const LOG_PREFIX = "[BundleManifest]";
const MAX_MANIFEST_SERIALIZED_CODE_UNITS = 4 * 1024 * 1024;
const MAX_MANIFEST_URL_LENGTH = 8 * 1024;
const MANIFEST_ID_PATTERN = /^[a-f0-9]{64}$/i;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) <= 0x1f) return true;
  }
  return false;
}

export type ManifestValidationReason = "manifest_missing" | "bundle_missing";

/** Result of manifest validation. */
export interface ManifestValidationResult {
  valid: boolean;
  failedHashes: string[];
  reason?: ManifestValidationReason;
}

export type BundleRecoveryFn = (
  bundles: Array<{ path: string; hash: string }>,
  cacheDir: string,
) => Promise<string[]>;

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
  return computeHash([...new Set(hashes)].sort(compareStrings).join(":"));
}

/**
 * Create a bundle manifest from collected bundle metadata.
 */
export async function createBundleManifest(bundles: BundleEntry[]): Promise<BundleManifest> {
  if (bundles.length === 0 || bundles.length > MAX_HTTP_BUNDLE_GRAPH_ENTRIES) {
    throw new TypeError(
      `Bundle manifest must contain 1-${MAX_HTTP_BUNDLE_GRAPH_ENTRIES} entries`,
    );
  }

  const byHash = new Map<string, BundleEntry>();
  for (const bundle of bundles) {
    if (
      !isValidHttpBundleHash(bundle.hash) ||
      typeof bundle.url !== "string" ||
      bundle.url.length > MAX_MANIFEST_URL_LENGTH ||
      containsControlCharacter(bundle.url) ||
      !Number.isSafeInteger(bundle.sizeBytes) ||
      bundle.sizeBytes < 0 ||
      bundle.sizeBytes > MAX_CACHED_HTTP_BUNDLE_BYTES
    ) {
      throw new TypeError("Bundle manifest entry is invalid");
    }
    if (!byHash.has(bundle.hash)) byHash.set(bundle.hash, bundle);
  }
  const orderedBundles = [...byHash.values()].sort((left, right) =>
    left.hash.localeCompare(right.hash)
  );
  const hashes = orderedBundles.map((bundle) => bundle.hash);
  const manifestId = await computeManifestId(hashes);

  rememberBundleManifestHashes(hashes, manifestId);

  return {
    manifestId,
    bundles: orderedBundles,
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
    const serialized = JSON.stringify(manifest);
    if (serialized.length > MAX_MANIFEST_SERIALIZED_CODE_UNITS) {
      logger.warn(`${LOG_PREFIX} Refusing to store oversized manifest`, {
        manifestId: manifest.manifestId.slice(0, 12),
      });
      return;
    }
    await cache.set(key, serialized, manifest.ttlSeconds);
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

function parseBundleEntry(value: unknown): BundleEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.hash !== "string" ||
    !isValidHttpBundleHash(record.hash) ||
    typeof record.url !== "string" ||
    record.url.length > MAX_MANIFEST_URL_LENGTH ||
    containsControlCharacter(record.url) ||
    !Number.isSafeInteger(record.sizeBytes) ||
    (record.sizeBytes as number) < 0 ||
    (record.sizeBytes as number) > MAX_CACHED_HTTP_BUNDLE_BYTES
  ) {
    return null;
  }
  return {
    hash: record.hash,
    url: record.url,
    sizeBytes: record.sizeBytes as number,
  };
}

/** Parse and authenticate a manifest loaded from an external cache backend. */
export async function parseBundleManifest(
  raw: string,
  expectedManifestId?: string,
): Promise<BundleManifest | null> {
  if (raw.length === 0 || raw.length > MAX_MANIFEST_SERIALIZED_CODE_UNITS) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.manifestId !== "string" ||
      !MANIFEST_ID_PATTERN.test(record.manifestId) ||
      expectedManifestId !== undefined && record.manifestId !== expectedManifestId ||
      !Array.isArray(record.bundles) ||
      record.bundles.length === 0 ||
      record.bundles.length > MAX_HTTP_BUNDLE_GRAPH_ENTRIES ||
      !Number.isSafeInteger(record.createdAt) ||
      (record.createdAt as number) < 0 ||
      !Number.isSafeInteger(record.ttlSeconds) ||
      (record.ttlSeconds as number) < 0
    ) {
      return null;
    }

    const bundles: BundleEntry[] = [];
    const seen = new Set<string>();
    for (const rawBundle of record.bundles) {
      const bundle = parseBundleEntry(rawBundle);
      if (!bundle || seen.has(bundle.hash)) return null;
      seen.add(bundle.hash);
      bundles.push(bundle);
    }
    if (await computeManifestId(bundles.map(({ hash }) => hash)) !== record.manifestId) {
      return null;
    }

    return {
      manifestId: record.manifestId,
      bundles,
      createdAt: record.createdAt as number,
      ttlSeconds: record.ttlSeconds as number,
    };
  } catch {
    return null;
  }
}

/**
 * Load a bundle manifest from the distributed cache.
 */
async function loadBundleManifest(manifestId: string): Promise<BundleManifest | null> {
  const cache = await getCache();
  if (!cache) return null;

  const key = buildBundleManifestCacheKey(manifestId);

  try {
    const raw = await cache.get(key);
    return raw ? await parseBundleManifest(raw, manifestId) : null;
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
  recoverMissingBundles?: BundleRecoveryFn,
): Promise<ManifestValidationResult> {
  const manifest = await loadBundleManifest(manifestId);
  if (!manifest) {
    logger.debug(`${LOG_PREFIX} Manifest not found in distributed cache`, {
      manifestId: manifestId.slice(0, 12),
    });
    return { valid: false, failedHashes: [], reason: "manifest_missing" };
  }

  return validateBundleManifest(manifest, cacheDir, recoverMissingBundles);
}

export async function validateBundleManifest(
  manifest: BundleManifest,
  cacheDir: string,
  recoverMissingBundles?: BundleRecoveryFn,
): Promise<ManifestValidationResult> {
  if (
    manifest.bundles.length === 0 ||
    manifest.bundles.length > MAX_HTTP_BUNDLE_GRAPH_ENTRIES ||
    manifest.bundles.some(({ hash }) => !isValidHttpBundleHash(hash))
  ) {
    logger.warn(`${LOG_PREFIX} Manifest bundle set is invalid`, {
      manifestId: manifest.manifestId.slice(0, 12),
      bundleCount: manifest.bundles.length,
      max: MAX_HTTP_BUNDLE_GRAPH_ENTRIES,
    });
    return {
      valid: false,
      failedHashes: manifest.bundles
        .filter(({ hash }) => !isValidHttpBundleHash(hash))
        .map(({ hash }) => hash),
      reason: "bundle_missing",
    };
  }

  const bundles = [...new Map(
    manifest.bundles.map(({ hash }) => [
      hash,
      { path: join(cacheDir, `http-${hash}.mjs`), hash },
    ]),
  ).values()];
  const validateOrRecover = recoverMissingBundles ??
    (async (roots: Array<{ path: string; hash: string }>, rootCacheDir: string) =>
      await validateBundleDepsExist(roots, rootCacheDir) ? [] : roots.map(({ hash }) => hash));

  logger.debug(`${LOG_PREFIX} Validating manifest bundle graph`, {
    manifestId: manifest.manifestId.slice(0, 12),
    total: bundles.length,
  });

  const unrecoverableHashes = await validateOrRecover(bundles, cacheDir);
  if (unrecoverableHashes.length > 0) {
    logger.warn(`${LOG_PREFIX} Some bundles could not be recovered`, {
      manifestId: manifest.manifestId.slice(0, 12),
      unrecoverable: unrecoverableHashes,
    });
    return { valid: false, failedHashes: unrecoverableHashes, reason: "bundle_missing" };
  }

  logger.debug(`${LOG_PREFIX} Bundle graph is complete`, {
    manifestId: manifest.manifestId.slice(0, 12),
    total: bundles.length,
  });

  return { valid: true, failedHashes: [] };
}
