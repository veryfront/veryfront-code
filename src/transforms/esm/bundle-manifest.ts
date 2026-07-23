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
import { exists } from "#veryfront/platform/compat/fs.ts";
import { rememberBundleManifestHashes } from "./bundle-manifest-ttl.ts";
import type { BundleEntry, BundleManifest } from "./bundle-manifest-types.ts";
import { errorLogName } from "../shared/log-context.ts";
export type { BundleEntry, BundleManifest } from "./bundle-manifest-types.ts";
export { getManifestIdForHash, refreshManifestTTL } from "./bundle-manifest-ttl.ts";

const LOG_PREFIX = "[BundleManifest]";
const MAX_MANIFEST_BUNDLES = 10_000;
const MAX_MANIFEST_JSON_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_IDENTIFIER_LENGTH = 256;
const MAX_MANIFEST_URL_LENGTH = 16_384;
const MAX_MANIFEST_TTL_SECONDS = 365 * 24 * 60 * 60;
const manifestEncoder = new TextEncoder();

export type ManifestValidationReason =
  | "manifest_missing"
  | "manifest_invalid"
  | "bundle_missing";

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

function isSafeManifestIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_MANIFEST_IDENTIFIER_LENGTH && /^[A-Za-z0-9_-]+$/.test(value);
}

function normalizeBundleEntry(value: unknown): BundleEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (
    !isSafeManifestIdentifier(entry.hash) ||
    typeof entry.url !== "string" || entry.url.length === 0 ||
    entry.url.length > MAX_MANIFEST_URL_LENGTH ||
    typeof entry.sizeBytes !== "number" || !Number.isSafeInteger(entry.sizeBytes) ||
    entry.sizeBytes < 0
  ) {
    return null;
  }

  try {
    const parsedUrl = new URL(entry.url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return null;
  } catch {
    return null;
  }

  return { hash: entry.hash, url: entry.url, sizeBytes: entry.sizeBytes };
}

function normalizeBundleManifest(
  value: unknown,
  expectedManifestId?: string,
): BundleManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !isSafeManifestIdentifier(record.manifestId) ||
    (expectedManifestId !== undefined && record.manifestId !== expectedManifestId) ||
    !Array.isArray(record.bundles) || record.bundles.length > MAX_MANIFEST_BUNDLES ||
    typeof record.createdAt !== "number" || !Number.isSafeInteger(record.createdAt) ||
    record.createdAt < 0 ||
    typeof record.ttlSeconds !== "number" || !Number.isFinite(record.ttlSeconds) ||
    record.ttlSeconds <= 0 || record.ttlSeconds > MAX_MANIFEST_TTL_SECONDS
  ) {
    return null;
  }

  const bundles: BundleEntry[] = [];
  const hashes = new Set<string>();
  for (const candidate of record.bundles) {
    const entry = normalizeBundleEntry(candidate);
    if (!entry || hashes.has(entry.hash)) return null;
    hashes.add(entry.hash);
    bundles.push(entry);
  }

  return {
    manifestId: record.manifestId,
    bundles,
    createdAt: record.createdAt,
    ttlSeconds: record.ttlSeconds,
  };
}

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
  if (
    !Array.isArray(hashes) || hashes.length > MAX_MANIFEST_BUNDLES ||
    hashes.some((hash) => !isSafeManifestIdentifier(hash))
  ) {
    throw new TypeError("Bundle manifest hashes are invalid");
  }
  return computeHash([...hashes].sort().join(":"));
}

/**
 * Create a bundle manifest from collected bundle metadata.
 */
export async function createBundleManifest(bundles: BundleEntry[]): Promise<BundleManifest> {
  const hashes = bundles.map((b) => b.hash);
  const manifestId = await computeManifestId(hashes);
  const manifest = normalizeBundleManifest({
    manifestId,
    bundles,
    createdAt: Date.now(),
    ttlSeconds: BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC,
  });
  if (!manifest) throw new TypeError("Bundle manifest input is invalid");

  rememberBundleManifestHashes(hashes, manifestId);
  return manifest;
}

/**
 * Store a bundle manifest in the distributed cache.
 */
export async function storeBundleManifest(manifest: BundleManifest): Promise<void> {
  const normalizedManifest = normalizeBundleManifest(manifest);
  if (!normalizedManifest) throw new TypeError("Bundle manifest input is invalid");

  const cache = await getCache();
  if (!cache) {
    logger.debug(`${LOG_PREFIX} No distributed cache available, skipping manifest store`);
    return;
  }

  const key = buildBundleManifestCacheKey(normalizedManifest.manifestId);

  try {
    await cache.set(
      key,
      JSON.stringify(normalizedManifest),
      normalizedManifest.ttlSeconds,
    );
    logger.debug(`${LOG_PREFIX} Stored manifest`, {
      manifestId: normalizedManifest.manifestId.slice(0, 12),
      bundleCount: normalizedManifest.bundles.length,
    });
  } catch (error) {
    logger.warn(`${LOG_PREFIX} Failed to store manifest`, {
      manifestId: normalizedManifest.manifestId.slice(0, 12),
      errorName: errorLogName(error),
    });
  }
}

/**
 * Load a bundle manifest from the distributed cache.
 */
async function loadBundleManifest(
  manifestId: string,
): Promise<{ manifest: BundleManifest | null; invalid: boolean }> {
  const cache = await getCache();
  if (!cache) return { manifest: null, invalid: false };

  const key = buildBundleManifestCacheKey(manifestId);

  try {
    const raw = await cache.get(key);
    if (!raw) return { manifest: null, invalid: false };
    if (
      raw.length > MAX_MANIFEST_JSON_BYTES ||
      manifestEncoder.encode(raw).byteLength > MAX_MANIFEST_JSON_BYTES
    ) {
      return { manifest: null, invalid: true };
    }
    const manifest = normalizeBundleManifest(JSON.parse(raw) as unknown, manifestId);
    return { manifest, invalid: manifest === null };
  } catch (error) {
    logger.debug(`${LOG_PREFIX} Failed to load manifest`, {
      manifestId: manifestId.slice(0, 12),
      errorName: errorLogName(error),
    });
    return { manifest: null, invalid: true };
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
  const { manifest, invalid } = await loadBundleManifest(manifestId);
  if (!manifest) {
    logger.debug(`${LOG_PREFIX} Manifest not found in distributed cache`, {
      manifestId: manifestId.slice(0, 12),
    });
    return {
      valid: false,
      failedHashes: [],
      reason: invalid ? "manifest_invalid" : "manifest_missing",
    };
  }

  return validateBundleManifest(manifest, cacheDir, recoverMissingBundles);
}

export async function validateBundleManifest(
  manifest: BundleManifest,
  cacheDir: string,
  recoverMissingBundles: BundleRecoveryFn = (missing) =>
    Promise.resolve(missing.map(({ hash }) => hash)),
): Promise<ManifestValidationResult> {
  const normalizedManifest = normalizeBundleManifest(manifest);
  if (!normalizedManifest) {
    return { valid: false, failedHashes: [], reason: "manifest_invalid" };
  }
  const missingBundles: Array<{ path: string; hash: string }> = [];

  await Promise.all(
    normalizedManifest.bundles.map(async ({ hash }) => {
      try {
        const path = join(cacheDir, `http-${hash}.mjs`);
        if (!(await exists(path))) missingBundles.push({ path, hash });
      } catch {
        missingBundles.push({ path: join(cacheDir, `http-${hash}.mjs`), hash });
      }
    }),
  );

  if (missingBundles.length === 0) return { valid: true, failedHashes: [] };

  logger.info(`${LOG_PREFIX} Attempting to recover missing bundles`, {
    manifestId: normalizedManifest.manifestId.slice(0, 12),
    missing: missingBundles.length,
    total: normalizedManifest.bundles.length,
  });

  const unrecoverableHashes = await recoverMissingBundles(missingBundles, cacheDir);
  if (unrecoverableHashes.length > 0) {
    logger.warn(`${LOG_PREFIX} Some bundles could not be recovered`, {
      manifestId: normalizedManifest.manifestId.slice(0, 12),
      unrecoverable: unrecoverableHashes,
    });
    return { valid: false, failedHashes: unrecoverableHashes, reason: "bundle_missing" };
  }

  logger.info(`${LOG_PREFIX} All missing bundles recovered successfully`, {
    manifestId: normalizedManifest.manifestId.slice(0, 12),
    recovered: missingBundles.length,
  });

  return { valid: true, failedHashes: [] };
}
