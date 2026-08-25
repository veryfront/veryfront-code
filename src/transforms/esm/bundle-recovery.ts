/**
 * Bundle recovery and invalidation for HTTP module cache.
 *
 * Recovers missing bundles from distributed cache, re-fetches from origin
 * URLs, and scans for parent bundles as a last resort. Also provides
 * invalidation for corrupted bundles.
 *
 * @module transforms/esm/bundle-recovery
 */

import { createFileSystem, exists } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { rendererLogger } from "#veryfront/utils";
import { httpBundleCache } from "./http-cache-wrapper.ts";
import { unbrand } from "./http-cache-types.ts";
import { VeryfrontError } from "./http-cache-invariants.ts";
import { extractSourceUrl } from "./source-url-embed.ts";
import {
  buildHttpCacheIdentity,
  type CacheOptions,
  ensureAbsoluteDir,
  hashHttpCacheIdentity,
  hasIncompatibleFilePaths,
  type HttpCacheIdentityMetadata,
  type HttpCacheIdentityOptions,
} from "./http-cache-helpers.ts";
import { extractBundleDeps, findParentBundleWithEmbeddedUrl } from "./bundle-deps-validator.ts";
import { getCachedPaths } from "./http-cache-state.ts";
import {
  isHttpBundleCodeWithinLimit,
  isValidHttpBundleHash,
  MAX_HTTP_BUNDLE_GRAPH_ENTRIES,
  readCachedHttpBundleFile,
} from "./http-bundle-file.ts";
import { isDegradedArtifact } from "./degraded-artifact.ts";

const logger = rendererLogger.component("http-cache");

/** Function signature for caching an HTTP module and returning its local path. */
type CacheHttpModuleFn = (url: string, options: CacheOptions) => Promise<string | null>;

const EMPTY_IMPORT_MAP = { imports: {}, scopes: {} };

function createRecoveryCacheOptions(
  cacheDir: string,
  identity?: HttpCacheIdentityOptions,
): CacheOptions {
  return {
    cacheDir,
    importMap: identity?.importMap ?? EMPTY_IMPORT_MAP,
    reactVersion: identity?.reactVersion,
    serverExternalPackages: identity?.serverExternalPackages,
  };
}

function cacheIdentityForRecovery(
  url: string,
  identity?: HttpCacheIdentityOptions,
): Promise<string> {
  return buildHttpCacheIdentity(
    url,
    identity ?? { importMap: EMPTY_IMPORT_MAP },
  );
}

async function rememberRecoveredPath(
  hash: string,
  cacheDir: string,
  url: string,
  cachePath: string,
  identity?: HttpCacheIdentityOptions,
): Promise<void> {
  const cacheIdentity = await cacheIdentityForRecovery(url, identity);
  if (await hashHttpCacheIdentity(cacheIdentity) !== hash) return;
  getCachedPaths().set(`${cacheDir}:${cacheIdentity}`, cachePath);
}

interface ResolvedRecoveryIdentity {
  originalUrl: string | null;
  options?: HttpCacheIdentityOptions;
  metadata: HttpCacheIdentityMetadata | null;
}

async function resolveRecoveryIdentity(
  hash: string,
  fallback?: HttpCacheIdentityOptions,
): Promise<ResolvedRecoveryIdentity> {
  const metadata = await httpBundleCache.getIdentityMetadata(hash);
  return {
    originalUrl: metadata?.url ?? await httpBundleCache.getOriginalUrl(hash),
    options: metadata ?? fallback,
    metadata,
  };
}

/**
 * Recover a missing HTTP bundle by looking up the code directly from the hash.
 * Used for cross-pod recovery when a file:// path points to a bundle that
 * exists in distributed cache but not on the local filesystem.
 */
export async function recoverHttpBundleByHash(
  hash: string,
  cacheDir: string,
  cacheHttpModule: CacheHttpModuleFn,
  parentCode?: string,
  fallbackIdentity?: HttpCacheIdentityOptions,
): Promise<boolean> {
  if (!isValidHttpBundleHash(hash)) return false;

  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);
  const cachePath = join(absoluteCacheDir, `http-${hash}.mjs`);
  const fs = createFileSystem();

  try {
    const recoveryIdentity = await resolveRecoveryIdentity(hash, fallbackIdentity);
    const result = await httpBundleCache.getCodeByHash(hash);

    if (result.code) {
      const cachedCode = unbrand(result.code);

      if (
        !isHttpBundleCodeWithinLimit(cachedCode) ||
        isDegradedArtifact(cachedCode) ||
        hasIncompatibleFilePaths(cachedCode, absoluteCacheDir)
      ) {
        logger.warn("Cached code has incompatible file paths, will re-fetch", {
          hash,
          localCacheDir: absoluteCacheDir,
        });
      } else {
        logger.info(
          result.wasGzipped
            ? "[HTTP-CACHE] Recovering bundle via direct code lookup (gzip decoded)"
            : "[HTTP-CACHE] Recovering bundle via direct code lookup",
          { hash },
        );

        await fs.mkdir(absoluteCacheDir, { recursive: true });
        await fs.writeTextFile(cachePath, cachedCode);

        if (recoveryIdentity.originalUrl) {
          await rememberRecoveredPath(
            hash,
            absoluteCacheDir,
            recoveryIdentity.originalUrl,
            cachePath,
            recoveryIdentity.options,
          );
          logger.debug("Updated LRU cache after recovery", {
            hash,
            identitySource: recoveryIdentity.metadata ? "stored" : "legacy",
          });
        }

        logger.info("Bundle recovery successful (direct)", { hash, path: cachePath });

        const transitiveDeps = extractBundleDeps(cachedCode)
          .filter(({ hash: dependencyHash }) => dependencyHash !== hash)
          .map(({ hash: dependencyHash }) => ({
            path: join(absoluteCacheDir, `http-${dependencyHash}.mjs`),
            hash: dependencyHash,
          }));

        if (transitiveDeps.length > 0) {
          logger.info("Recovering transitive deps from last-resort recovery", {
            count: transitiveDeps.length,
          });
          const failedDependencies = await ensureHttpBundlesExist(
            transitiveDeps,
            cacheDir,
            cacheHttpModule,
            recoveryIdentity.options,
          );
          if (failedDependencies.length > 0) {
            logger.warn("Direct recovery left transitive dependencies unresolved", {
              hash,
              failedDependencies,
            });
            return false;
          }
        }

        return true;
      }
    } else if (result.failReason) {
      logger.debug("Direct code lookup failed", { hash, reason: result.failReason });
    }

    // Fallback: try to recover via URL re-fetch
    const originalUrl = recoveryIdentity.originalUrl;
    if (originalUrl) {
      logger.info("Recovering bundle via URL re-fetch", { hash, originalUrl });
      const result = await cacheHttpModule(
        originalUrl,
        createRecoveryCacheOptions(cacheDir, recoveryIdentity.options),
      );
      if (result === cachePath || result && await exists(cachePath)) {
        logger.info("Bundle recovery successful (re-fetch)", { hash, path: result });
        return true;
      }
      if (result && /^\d+$/.test(hash) && await exists(result)) {
        const recoveredBundle = await readCachedHttpBundleFile(fs, result);
        if (!recoveredBundle || isDegradedArtifact(recoveredBundle.code)) return false;
        await fs.mkdir(absoluteCacheDir, { recursive: true });
        await fs.writeTextFile(cachePath, recoveredBundle.code);
        logger.info("Materialized re-fetched bundle at legacy cache path", {
          hash,
          sourcePath: result,
          legacyPath: cachePath,
        });
        return true;
      }
      if (result) {
        logger.warn("URL re-fetch produced a different cache identity", {
          hash,
          expectedPath: cachePath,
          actualPath: result,
        });
      }
    }

    // Last resort: try to extract source URL from parent bundle and re-fetch parent
    if (parentCode) {
      const parentSourceUrl = extractSourceUrl(parentCode);
      if (parentSourceUrl) {
        logger.info("Attempting recovery via parent URL re-fetch", {
          hash,
          parentUrl: parentSourceUrl,
        });

        const parentHash = await hashHttpCacheIdentity(
          await cacheIdentityForRecovery(parentSourceUrl, recoveryIdentity.options),
        );
        await httpBundleCache.deleteCode(parentHash);

        const parentPath = join(absoluteCacheDir, `http-${parentHash}.mjs`);
        try {
          await fs.remove(parentPath);
        } catch (_) {
          /* expected: file may not exist */
        }

        const result = await cacheHttpModule(
          parentSourceUrl,
          createRecoveryCacheOptions(cacheDir, recoveryIdentity.options),
        );
        if (result) {
          if (await exists(cachePath)) {
            logger.info("Bundle recovery successful (parent re-fetch)", {
              hash,
              path: cachePath,
            });
            return true;
          }
        }

        logger.warn("Parent re-fetch did not recover target bundle", {
          hash,
          parentUrl: parentSourceUrl,
        });
      }
    }

    // Final fallback: scan local cache for a bundle that imports this hash
    if (!parentCode) {
      const foundParent = await findParentBundleWithEmbeddedUrl(hash, absoluteCacheDir, fs);
      if (foundParent) {
        logger.info("Found parent bundle in local cache, attempting recovery", {
          hash,
          parentUrl: foundParent.sourceUrl,
        });

        const parentHash = await hashHttpCacheIdentity(
          await cacheIdentityForRecovery(foundParent.sourceUrl, recoveryIdentity.options),
        );
        await httpBundleCache.deleteCode(parentHash);

        try {
          await fs.remove(foundParent.path);
        } catch (_) {
          /* expected: file may not exist */
        }

        const result = await cacheHttpModule(
          foundParent.sourceUrl,
          createRecoveryCacheOptions(cacheDir, recoveryIdentity.options),
        );
        if (result && await exists(cachePath)) {
          logger.info("Bundle recovery successful (local parent scan)", {
            hash,
            path: cachePath,
          });
          return true;
        }
      }
    }

    logger.debug("No recovery data found for hash", { hash });
    return false;
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "cache-invariant-violation") {
      logger.error("Cache invariant violation during recovery", { hash, error });
      throw error;
    }
    logger.error("Bundle recovery failed", { hash, error });
    return false;
  }
}

/**
 * Ensure all HTTP bundles exist locally before import.
 * Proactively fetches missing bundles from distributed cache.
 */
export async function ensureHttpBundlesExist(
  bundlePaths: Array<{ path: string; hash: string }>,
  cacheDir: string,
  cacheHttpModule: CacheHttpModuleFn,
  fallbackIdentity?: HttpCacheIdentityOptions,
): Promise<string[]> {
  if (bundlePaths.length === 0) return [];

  const fs = createFileSystem();
  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);

  const pending: Array<{ hash: string }> = [];
  const seen = new Set<string>();
  const failed = new Set<string>();
  for (const { hash } of bundlePaths) {
    if (!isValidHttpBundleHash(hash)) {
      failed.add(hash);
      continue;
    }
    if (!pending.some((entry) => entry.hash === hash)) pending.push({ hash });
  }
  if (pending.length > MAX_HTTP_BUNDLE_GRAPH_ENTRIES) {
    for (const { hash } of pending.slice(MAX_HTTP_BUNDLE_GRAPH_ENTRIES)) failed.add(hash);
    pending.length = MAX_HTTP_BUNDLE_GRAPH_ENTRIES;
  }

  while (pending.length > 0) {
    const batchByHash = new Map<string, { hash: string }>();
    for (const entry of pending.splice(0, pending.length)) {
      if (!seen.has(entry.hash)) batchByHash.set(entry.hash, entry);
    }
    const batch = [...batchByHash.values()];
    if (batch.length === 0) break;
    if (seen.size + batch.length > MAX_HTTP_BUNDLE_GRAPH_ENTRIES) {
      for (const { hash } of batch) failed.add(hash);
      break;
    }

    for (const item of batch) seen.add(item.hash);

    const existenceChecks = await Promise.all(
      batch.map(async ({ hash }) => {
        const canonicalPath = join(absoluteCacheDir, `http-${hash}.mjs`);
        const bundle = await readCachedHttpBundleFile(fs, canonicalPath);
        return { hash, canonicalPath, bundle };
      }),
    );

    const presentLocally = existenceChecks.filter((entry) =>
      entry.bundle !== null && !isDegradedArtifact(entry.bundle.code)
    );
    const missing = existenceChecks.filter((entry) =>
      entry.bundle === null || isDegradedArtifact(entry.bundle.code)
    );

    for (const { bundle } of presentLocally) {
      for (const dep of extractBundleDeps(bundle!.code)) {
        if (!seen.has(dep.hash)) pending.push({ hash: dep.hash });
      }
    }

    if (missing.length === 0) continue;

    logger.info("Fetching missing bundles from distributed cache", {
      missing: missing.length,
      total: batch.length,
    });

    const cacheAvailable = await httpBundleCache.isAvailable();
    if (!cacheAvailable) {
      logger.error("No distributed cache available for bundle recovery");
      for (const m of missing) failed.add(m.hash);
      continue;
    }

    const codes = await httpBundleCache.getBatchCodes(missing.map((m) => m.hash));

    await Promise.all(
      missing.map(async ({ hash, canonicalPath }) => {
        const localCode = codes.get(hash);
        if (!localCode) {
          const recovered = await recoverHttpBundleByHash(
            hash,
            absoluteCacheDir,
            cacheHttpModule,
            undefined,
            fallbackIdentity,
          );
          if (!recovered) {
            failed.add(hash);
            return;
          }

          const recoveredBundle = await readCachedHttpBundleFile(fs, canonicalPath);
          if (!recoveredBundle || isDegradedArtifact(recoveredBundle.code)) {
            failed.add(hash);
            return;
          }
          for (const dep of extractBundleDeps(recoveredBundle.code)) {
            if (!seen.has(dep.hash)) pending.push({ hash: dep.hash });
          }
          return;
        }

        const code = unbrand(localCode);

        if (
          !isHttpBundleCodeWithinLimit(code) ||
          isDegradedArtifact(code) ||
          hasIncompatibleFilePaths(code, absoluteCacheDir)
        ) {
          logger.warn(
            "[HTTP-CACHE] Batch-fetched code has incompatible file paths, trying single recovery",
            { hash, localCacheDir: absoluteCacheDir },
          );
          const recovered = await recoverHttpBundleByHash(
            hash,
            absoluteCacheDir,
            cacheHttpModule,
            undefined,
            fallbackIdentity,
          );
          if (!recovered) failed.add(hash);
          return;
        }

        try {
          await fs.mkdir(absoluteCacheDir, { recursive: true });
          await fs.writeTextFile(canonicalPath, code);
          logger.debug("Wrote bundle to disk", { hash, path: canonicalPath });

          const identity = await resolveRecoveryIdentity(hash, fallbackIdentity);
          if (identity.originalUrl) {
            await rememberRecoveredPath(
              hash,
              absoluteCacheDir,
              identity.originalUrl,
              canonicalPath,
              identity.options,
            );
          }

          for (const dep of extractBundleDeps(code)) {
            if (!seen.has(dep.hash)) pending.push({ hash: dep.hash });
          }
        } catch (error) {
          logger.error("Failed to write bundle to disk", { hash, error });
          failed.add(hash);
        }
      }),
    );
  }

  if (failed.size > 0) {
    logger.warn("Some bundles could not be recovered", {
      failed: Array.from(failed),
    });
  }

  return Array.from(failed);
}

/**
 * Invalidate a corrupted bundle from both local and distributed cache.
 */
export async function invalidateHttpBundle(hash: string, cacheDir: string): Promise<boolean> {
  if (!isValidHttpBundleHash(hash)) {
    logger.warn("Refusing to invalidate an invalid HTTP bundle hash");
    return false;
  }

  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);
  const cachePath = join(absoluteCacheDir, `http-${hash}.mjs`);
  const fs = createFileSystem();

  logger.info("Invalidating bundle", { hash, path: cachePath });

  try {
    const deleted = await httpBundleCache.deleteCode(hash);
    if (deleted) {
      logger.info("Deleted bundle from distributed cache", { hash });
    }

    try {
      await fs.remove(cachePath);
      logger.info("Deleted local bundle file", { hash, path: cachePath });
    } catch (_) {
      /* expected: file may not exist locally */
    }

    return true;
  } catch (error) {
    logger.error("Failed to invalidate bundle", { hash, error });
    return false;
  }
}
