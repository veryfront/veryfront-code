/****
 * Distributed transform cache read/write operations.
 *
 * Handles reading from and writing to the distributed (Redis/API) transform cache,
 * including validation of cached entries for the current environment.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/distributed-cache
 */

import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { detokenizeAllCachePaths, tokenizeAllVeryFrontPaths } from "#veryfront/cache";
import { cacheHttpImportsToLocal, ensureHttpBundlesExist } from "../../../esm/http-cache.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { extractHttpBundlePaths } from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";
import {
  createBundleManifest,
  storeBundleManifest,
  validateBundleGroup,
} from "../../../esm/bundle-manifest.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { FRAMEWORK_ROOT, LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { getDistributedTransformBackend } from "#veryfront/transforms/esm/transform-cache.ts";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { hasUnresolvedImports } from "./nested-imports.ts";
import {
  findMissingFileDependenciesInCode,
  hasIncompatibleFrameworkPaths,
} from "./framework-validator.ts";

/** TTL for cached transforms (uses centralized config) */
const TRANSFORM_CACHE_TTL_SECONDS = TRANSFORM_DISTRIBUTED_TTL_SEC;

/** Return type for getDistributedTransformBackend */
type DistributedCache = NonNullable<Awaited<ReturnType<typeof getDistributedTransformBackend>>>;

/**
 * Result of attempting to read from the distributed cache.
 *
 * Always returns the `distributedCache` handle (if available) so it can be
 * reused for writing after transform, even when the read was a miss.
 */
export interface DistributedCacheReadResult {
  /** The validated module code, or null if cache miss / validation failure */
  code: string | null;
  /** The distributed cache backend (for subsequent writes) */
  distributedCache: DistributedCache;
}

/**
 * Attempt to read and validate a module from the distributed transform cache.
 *
 * Performs multiple validation checks:
 * 1. Bundle manifest validation (if manifest ID exists)
 * 2. HTTP bundle existence (fallback if no manifest)
 * 3. Framework path compatibility
 * 4. Unresolved /_vf_modules/ import check
 * 5. Missing local file:// dependency check
 * 6. Legacy HTTP import conversion to file:// paths
 *
 * Returns null only if no distributed cache backend is available.
 * Otherwise returns `{ code, distributedCache }` where `code` may be null (cache miss).
 */
export async function readDistributedCache(
  transformCacheKey: string,
  normalizedPath: string,
  projectSlug: string,
  projectDir: string,
  reactVersion: string | undefined,
  log: Logger,
): Promise<DistributedCacheReadResult | null> {
  const distributedCache = await getDistributedTransformBackend();
  if (!distributedCache) return null;

  try {
    const cached = await distributedCache.get(transformCacheKey);
    if (!cached) return { code: null, distributedCache };

    // Detokenize all cache paths for local environment
    let moduleCode: string | null = detokenizeAllCachePaths(cached);
    log.debug(`${LOG_PREFIX_MDX_LOADER} Distributed transform cache HIT`, {
      projectSlug,
      normalizedPath,
      cacheKey: transformCacheKey,
    });

    const bundleManifestKey = `${transformCacheKey}:bm`;
    const manifestId = await distributedCache.get(bundleManifestKey).catch(() => null);

    if (manifestId) {
      const cacheDir = getHttpBundleCacheDir();
      const validation = await validateBundleGroup(manifestId, cacheDir);
      if (!validation.valid) {
        log.warn(`${LOG_PREFIX_MDX_LOADER} Bundle manifest validation failed`, {
          normalizedPath,
          manifestId: manifestId.slice(0, 12),
          failedHashes: validation.failedHashes,
        });
        moduleCode = null;
      }
    } else {
      // Use detokenized code for bundle path extraction
      const bundlePaths = extractHttpBundlePaths(moduleCode);
      if (bundlePaths.length > 0) {
        const cacheDir = getHttpBundleCacheDir();
        const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
        if (failed.length > 0) {
          log.warn(`${LOG_PREFIX_MDX_LOADER} Some HTTP bundles could not be recovered`, {
            normalizedPath,
            failed,
          });
          moduleCode = null;
        }
      }
    }

    // Use detokenized code for framework path checks
    if (moduleCode && await hasIncompatibleFrameworkPaths(moduleCode, log)) {
      log.warn(`${LOG_PREFIX_MDX_LOADER} Cached code has incompatible framework paths`, {
        normalizedPath,
        frameworkRoot: FRAMEWORK_ROOT,
      });
      moduleCode = null;
    }

    // CRITICAL: Check for unresolved /_vf_modules/ imports.
    // Stale cache entries may have unresolved paths from before this fix.
    if (moduleCode) {
      const unresolved = hasUnresolvedImports(moduleCode);
      if (unresolved.count > 0) {
        log.warn(
          `${LOG_PREFIX_MDX_LOADER} Cached code has ${unresolved.count} unresolved imports, invalidating`,
          { normalizedPath, unresolved: unresolved.paths },
        );
        moduleCode = null;
      }
    }

    // CRITICAL: Check that all file:// paths (vfmod modules, etc.) exist locally.
    // Distributed cache may return code with file:// paths from other pods/runs
    // that don't exist on this machine.
    if (moduleCode) {
      const missingDeps = await findMissingFileDependenciesInCode(moduleCode, log);
      if (missingDeps.length > 0) {
        log.warn(
          `${LOG_PREFIX_MDX_LOADER} Cached code has ${missingDeps.length} missing file dependencies, invalidating`,
          { normalizedPath, missingDeps: missingDeps.slice(0, 5) },
        );
        moduleCode = null;
      }
    }

    // Safety net: Convert any remaining HTTP imports to local file:// paths.
    // New cache entries should already have file:// paths, but old entries might have HTTP URLs.
    // This is a no-op for properly cached entries and fixes legacy cache entries.
    if (moduleCode) {
      const importMap = await loadImportMap(projectDir);
      const cacheResult = await cacheHttpImportsToLocal(moduleCode, {
        cacheDir: getHttpBundleCacheDir(),
        importMap,
        reactVersion,
      });
      if (cacheResult.code !== moduleCode) {
        log.debug(`${LOG_PREFIX_MDX_LOADER} Converted HTTP imports from legacy cache entry`, {
          normalizedPath,
        });
        moduleCode = cacheResult.code;
      }
    }

    return { code: moduleCode, distributedCache };
  } catch (error) {
    log.debug(`${LOG_PREFIX_MDX_LOADER} Distributed cache get failed`, {
      normalizedPath,
      error,
    });
    return { code: null, distributedCache };
  }
}

/**
 * Write a fully-resolved module to the distributed transform cache.
 *
 * Tokenizes all cache paths for cross-environment portability and creates
 * a bundle manifest companion key for atomic validation.
 *
 * This is fire-and-forget: errors are logged but do not propagate.
 */
export function writeDistributedCache(
  distributedCache: DistributedCache,
  transformCacheKey: string,
  moduleCode: string,
  normalizedPath: string,
  log: Logger,
): void {
  // Tokenize all cache paths for cross-environment portability
  // Uses aggressive tokenization to catch paths from ANY environment (build server, other pods)
  const portableCode = tokenizeAllVeryFrontPaths(moduleCode);

  // Store transformed code in distributed cache
  distributedCache
    .set(transformCacheKey, portableCode, TRANSFORM_CACHE_TTL_SECONDS)
    .catch((error) => {
      log.debug(`${LOG_PREFIX_MDX_LOADER} Distributed cache set failed`, {
        normalizedPath,
        error,
      });
    });

  // Create and store bundle manifest companion key for atomic validation
  const bundlePaths = extractHttpBundlePaths(moduleCode);
  if (bundlePaths.length > 0) {
    const entries = bundlePaths.map((b) => ({ hash: b.hash, url: "", sizeBytes: 0 }));
    createBundleManifest(entries).then(async (manifest) => {
      await storeBundleManifest(manifest);
      const bundleManifestKey = `${transformCacheKey}:bm`;
      await distributedCache.set(
        bundleManifestKey,
        manifest.manifestId,
        TRANSFORM_CACHE_TTL_SECONDS,
      );
    }).catch((error) => {
      log.debug(`${LOG_PREFIX_MDX_LOADER} Bundle manifest creation failed`, {
        normalizedPath,
        error,
      });
    });
  }
}
