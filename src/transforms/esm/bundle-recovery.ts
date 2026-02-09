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
import { rendererLogger as logger } from "#veryfront/utils";
import { simpleHash } from "#veryfront/utils/hash-utils.ts";
import { httpBundleCache } from "./http-cache-wrapper.ts";
import { VeryfrontError } from "./http-cache-invariants.ts";
import { extractSourceUrl } from "./source-url-embed.ts";
import {
  type CacheOptions,
  ensureAbsoluteDir,
  hasIncompatibleFilePaths,
  normalizeHttpUrl,
} from "./http-cache-helpers.ts";
import { extractBundleDeps, findParentBundleWithEmbeddedUrl } from "./bundle-deps-validator.ts";
import { getCachedPaths } from "./http-cache-state.ts";

/** Function signature for caching an HTTP module and returning its local path. */
type CacheHttpModuleFn = (url: string, options: CacheOptions) => Promise<string | null>;

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
): Promise<boolean> {
  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);
  const cachePath = join(absoluteCacheDir, `http-${hash}.mjs`);
  const fs = createFileSystem();

  try {
    const result = await httpBundleCache.getCodeByHash(hash);

    if (result.code) {
      const cachedCode = result.code as unknown as string;

      if (hasIncompatibleFilePaths(cachedCode, absoluteCacheDir)) {
        logger.warn("[HTTP-CACHE] Cached code has incompatible file paths, will re-fetch", {
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

        const originalUrl = await httpBundleCache.getOriginalUrl(hash);
        if (originalUrl) {
          const cacheKey = `${absoluteCacheDir}:${normalizeHttpUrl(originalUrl)}`;
          getCachedPaths().set(cacheKey, cachePath);
          logger.debug("[HTTP-CACHE] Updated LRU cache after recovery", { hash, cacheKey });
        }

        logger.info("[HTTP-CACHE] Bundle recovery successful (direct)", { hash, path: cachePath });

        const BUNDLE_RE = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-(\d+)\.mjs)/gi;
        const transitiveDeps: Array<{ path: string; hash: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = BUNDLE_RE.exec(cachedCode)) !== null) {
          const tHash = m[2]!;
          if (tHash === hash) continue;
          transitiveDeps.push({
            path: join(absoluteCacheDir, `http-${tHash}.mjs`),
            hash: tHash,
          });
        }

        if (transitiveDeps.length > 0) {
          logger.info("[HTTP-CACHE] Recovering transitive deps from last-resort recovery", {
            count: transitiveDeps.length,
          });
          await ensureHttpBundlesExist(transitiveDeps, cacheDir, cacheHttpModule);
        }

        return true;
      }
    } else if (result.failReason) {
      logger.debug("[HTTP-CACHE] Direct code lookup failed", { hash, reason: result.failReason });
    }

    // Fallback: try to recover via URL re-fetch
    const originalUrl = await httpBundleCache.getOriginalUrl(hash);
    if (originalUrl) {
      logger.info("[HTTP-CACHE] Recovering bundle via URL re-fetch", { hash, originalUrl });
      const importMap = { imports: {}, scopes: {} };
      const result = await cacheHttpModule(originalUrl, { cacheDir, importMap });
      if (result) {
        logger.info("[HTTP-CACHE] Bundle recovery successful (re-fetch)", { hash, path: result });
        return true;
      }
    }

    // Last resort: try to extract source URL from parent bundle and re-fetch parent
    if (parentCode) {
      const parentSourceUrl = extractSourceUrl(parentCode);
      if (parentSourceUrl) {
        logger.info("[HTTP-CACHE] Attempting recovery via parent URL re-fetch", {
          hash,
          parentUrl: parentSourceUrl,
        });

        const parentHash = simpleHash(normalizeHttpUrl(parentSourceUrl));
        await httpBundleCache.deleteCode(String(parentHash));

        const parentPath = join(absoluteCacheDir, `http-${parentHash}.mjs`);
        try {
          await fs.remove(parentPath);
        } catch {
          // Ignore if file doesn't exist
        }

        const importMap = { imports: {}, scopes: {} };
        const result = await cacheHttpModule(parentSourceUrl, { cacheDir, importMap });
        if (result) {
          if (await exists(cachePath)) {
            logger.info("[HTTP-CACHE] Bundle recovery successful (parent re-fetch)", {
              hash,
              path: cachePath,
            });
            return true;
          }
        }

        logger.warn("[HTTP-CACHE] Parent re-fetch did not recover target bundle", {
          hash,
          parentUrl: parentSourceUrl,
        });
      }
    }

    // Final fallback: scan local cache for a bundle that imports this hash
    if (!parentCode) {
      const foundParent = await findParentBundleWithEmbeddedUrl(hash, absoluteCacheDir, fs);
      if (foundParent) {
        logger.info("[HTTP-CACHE] Found parent bundle in local cache, attempting recovery", {
          hash,
          parentUrl: foundParent.sourceUrl,
        });

        const parentHashNum = simpleHash(normalizeHttpUrl(foundParent.sourceUrl));
        await httpBundleCache.deleteCode(String(parentHashNum));

        try {
          await fs.remove(foundParent.path);
        } catch {
          // Ignore if file doesn't exist
        }

        const importMap = { imports: {}, scopes: {} };
        const result = await cacheHttpModule(foundParent.sourceUrl, { cacheDir, importMap });
        if (result && await exists(cachePath)) {
          logger.info("[HTTP-CACHE] Bundle recovery successful (local parent scan)", {
            hash,
            path: cachePath,
          });
          return true;
        }
      }
    }

    logger.debug("[HTTP-CACHE] No recovery data found for hash", { hash });
    return false;
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "cache-invariant-violation") {
      logger.error("[HTTP-CACHE] Cache invariant violation during recovery", { hash, error });
      throw error;
    }
    logger.error("[HTTP-CACHE] Bundle recovery failed", { hash, error });
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
): Promise<string[]> {
  if (bundlePaths.length === 0) return [];

  const fs = createFileSystem();
  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);

  const pending: Array<{ hash: string }> = bundlePaths.map((b) => ({ hash: b.hash }));
  const seen = new Set<string>();
  const failed = new Set<string>();

  while (pending.length > 0) {
    const batch = pending.splice(0, pending.length).filter((b) => !seen.has(b.hash));
    if (batch.length === 0) break;

    for (const item of batch) seen.add(item.hash);

    const existenceChecks = await Promise.all(
      batch.map(async ({ hash }) => {
        const canonicalPath = join(absoluteCacheDir, `http-${hash}.mjs`);
        return {
          hash,
          canonicalPath,
          exists: await exists(canonicalPath),
        };
      }),
    );

    const presentLocally = existenceChecks.filter((b) => b.exists);
    const missing = existenceChecks.filter((b) => !b.exists);

    for (const { canonicalPath } of presentLocally) {
      try {
        const code = await fs.readTextFile(canonicalPath);
        for (const dep of extractBundleDeps(code)) {
          if (!seen.has(dep.hash)) pending.push({ hash: dep.hash });
        }
      } catch {
        /* ignore read errors for dep scanning */
      }
    }

    if (missing.length === 0) continue;

    logger.info("[HTTP-CACHE] Fetching missing bundles from distributed cache", {
      missing: missing.length,
      total: batch.length,
    });

    const cacheAvailable = await httpBundleCache.isAvailable();
    if (!cacheAvailable) {
      logger.error("[HTTP-CACHE] No distributed cache available for bundle recovery");
      for (const m of missing) failed.add(m.hash);
      continue;
    }

    const codes = await httpBundleCache.getBatchCodes(missing.map((m) => m.hash));

    await Promise.all(
      missing.map(async ({ hash, canonicalPath }) => {
        const localCode = codes.get(hash);
        if (!localCode) {
          const recovered = await recoverHttpBundleByHash(hash, absoluteCacheDir, cacheHttpModule);
          if (!recovered) {
            failed.add(hash);
            return;
          }

          try {
            const recoveredCode = await fs.readTextFile(canonicalPath);
            for (const dep of extractBundleDeps(recoveredCode)) {
              if (!seen.has(dep.hash)) pending.push({ hash: dep.hash });
            }
          } catch {
            /* ignore read errors for dep scanning */
          }
          return;
        }

        const code = localCode as unknown as string;

        if (hasIncompatibleFilePaths(code, absoluteCacheDir)) {
          logger.warn(
            "[HTTP-CACHE] Batch-fetched code has incompatible file paths, trying single recovery",
            { hash, localCacheDir: absoluteCacheDir },
          );
          const recovered = await recoverHttpBundleByHash(hash, absoluteCacheDir, cacheHttpModule);
          if (!recovered) failed.add(hash);
          return;
        }

        try {
          await fs.mkdir(absoluteCacheDir, { recursive: true });
          await fs.writeTextFile(canonicalPath, code);
          logger.debug("[HTTP-CACHE] Wrote bundle to disk", { hash, path: canonicalPath });

          const originalUrl = await httpBundleCache.getOriginalUrl(hash);
          if (originalUrl) {
            const cacheKey = `${absoluteCacheDir}:${normalizeHttpUrl(originalUrl)}`;
            getCachedPaths().set(cacheKey, canonicalPath);
          }

          for (const dep of extractBundleDeps(code)) {
            if (!seen.has(dep.hash)) pending.push({ hash: dep.hash });
          }
        } catch (error) {
          logger.error("[HTTP-CACHE] Failed to write bundle to disk", { hash, error });
          failed.add(hash);
        }
      }),
    );
  }

  if (failed.size > 0) {
    logger.warn("[HTTP-CACHE] Some bundles could not be recovered", {
      failed: Array.from(failed),
    });
  }

  return Array.from(failed);
}

/**
 * Invalidate a corrupted bundle from both local and distributed cache.
 */
export async function invalidateHttpBundle(hash: string, cacheDir: string): Promise<boolean> {
  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);
  const cachePath = join(absoluteCacheDir, `http-${hash}.mjs`);
  const fs = createFileSystem();

  logger.info("[HTTP-CACHE] Invalidating bundle", { hash, path: cachePath });

  try {
    const deleted = await httpBundleCache.deleteCode(hash);
    if (deleted) {
      logger.info("[HTTP-CACHE] Deleted bundle from distributed cache", { hash });
    }

    try {
      await fs.remove(cachePath);
      logger.info("[HTTP-CACHE] Deleted local bundle file", { hash, path: cachePath });
    } catch {
      // File might not exist locally, that's fine
    }

    return true;
  } catch (error) {
    logger.error("[HTTP-CACHE] Failed to invalidate bundle", { hash, error });
    return false;
  }
}
