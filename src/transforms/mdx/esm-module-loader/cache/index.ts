/****
 * ESM Module Cache Operations
 *
 * Manages persistent module path caching for ESM module loading.
 *
 * @module build/transforms/mdx/esm-module-loader/cache
 */

import { join } from "#veryfront/compat/path";
import { rendererLogger as logger } from "#veryfront/utils";
import {
  getCacheBaseDir,
  getHttpBundleCacheDir,
  getMdxEsmCacheDir,
} from "#veryfront/utils/cache-dir.ts";
import {
  createFileSystem,
  type FileSystem,
  isNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";

export type CacheLookupResult =
  | { status: "hit"; path: string }
  | { status: "miss" }
  | { status: "corrupted"; reason: string; filePath: string };

const MAX_VERIFIED_MODULE_DEPS = 2_000;

export const verifiedModuleDeps = new LRUCache<string, true>({
  maxEntries: MAX_VERIFIED_MODULE_DEPS,
});

const FILE_PATH_PATTERN = /file:\/\/([^"'\s]+)/gi;

/**
 * Check if cached code has file:// paths from a different environment.
 * Checks both HTTP bundle paths and MDX ESM cache paths.
 */
function hasIncompatibleCachePaths(code: string): boolean {
  const localCacheBaseDir = getCacheBaseDir();
  const localHttpCacheDir = getHttpBundleCacheDir();
  const localMdxCacheDir = getMdxEsmCacheDir();
  const pattern = new RegExp(FILE_PATH_PATTERN.source, "gi");

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const path = match[1];
    if (!path) continue;

    // Check HTTP bundle paths
    if (path.includes("veryfront-http-bundle") && !path.startsWith(localHttpCacheDir)) {
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Cached module has incompatible HTTP bundle path`, {
        path,
        expectedDir: localHttpCacheDir,
      });
      return true;
    }

    // Check MDX ESM cache paths
    if (path.includes("veryfront-mdx-esm") && !path.startsWith(localMdxCacheDir)) {
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Cached module has incompatible MDX ESM path`, {
        path,
        expectedDir: localMdxCacheDir,
      });
      return true;
    }

    // Check any other cache paths (future-proofing)
    if (path.includes(".cache/") && !path.startsWith(localCacheBaseDir)) {
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Cached module has incompatible cache path`, {
        path,
        expectedDir: localCacheBaseDir,
      });
      return true;
    }
  }

  return false;
}

/**
 * Check if all file:// dependencies in cached code exist on disk.
 * Returns list of missing file paths, or empty array if all exist.
 */
async function findMissingFileDependencies(code: string): Promise<string[]> {
  const localFs = getLocalFs();
  const pattern = new RegExp(FILE_PATH_PATTERN.source, "gi");
  const missing: string[] = [];
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const path = match[1] as string;
    // Skip query parameters in paths
    const cleanPath = path.replace(/\?.*$/, "");
    try {
      const stat = await localFs.stat(cleanPath);
      if (!stat?.isFile) {
        missing.push(cleanPath);
      }
    } catch (_) {
      /* expected: file dependency may not exist on disk */
      missing.push(cleanPath);
    }
  }
  return missing;
}

/**
 * Pattern to match unresolved /_vf_modules/ imports that weren't converted to proper file:// paths.
 * Matches both:
 * - `from "/_vf_modules/..."` or `from "_vf_modules/..."` (unresolved)
 * - `from "file:///_vf_modules/..."` (malformed - points to non-existent root /_vf_modules/)
 * Note: Uses \s* instead of \s+ because minified code may have no space after `from`.
 * These imports will fail at runtime because they can't be resolved by Deno's dynamic import.
 */
const UNRESOLVED_VF_MODULES_PATTERN = /from\s*["']((?:file:\/\/)?\/?\/?_vf_modules\/[^"']+)["']/g;

/**
 * Check if cached code has unresolved or malformed /_vf_modules/ imports.
 * These should have been resolved to proper file:// paths (e.g., file:///Users/.cache/...).
 * Returns true if any unresolved or malformed imports are found.
 */
function hasUnresolvedVfModules(code: string): boolean {
  const pattern = new RegExp(UNRESOLVED_VF_MODULES_PATTERN.source, "g");
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const importPath = match[1] as string;
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Cached module has unresolved _vf_modules import`, {
      importPath,
    });
    return true;
  }
  return false;
}

// Local filesystem for cache operations (not project's FSAdapter which may be remote/read-only)
// This uses the platform's native fs (Deno, Node, Bun) for local cache writes
let localFs: FileSystem | null = null;

export function getLocalFs(): FileSystem {
  localFs ??= createFileSystem();
  return localFs;
}

const modulePathCaches = new Map<string, Map<string, string>>();
const modulePathCacheLoaded = new Set<string>();

export async function getModulePathCache(cacheDir: string): Promise<Map<string, string>> {
  const existing = modulePathCaches.get(cacheDir);
  if (existing && modulePathCacheLoaded.has(cacheDir)) return existing;

  const cache = existing ?? new Map<string, string>();
  modulePathCaches.set(cacheDir, cache);

  const indexPath = join(cacheDir, "_index.json");

  try {
    const content = await getLocalFs().readTextFile(indexPath);
    const index = JSON.parse(content) as Record<string, string>;
    for (const [path, cachePath] of Object.entries(index)) {
      cache.set(path, cachePath);
    }
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Loaded module index: ${cache.size} entries`);
  } catch (_) {
    /* expected: _index.json may not exist yet */
  }

  modulePathCacheLoaded.add(cacheDir);
  return cache;
}

export async function saveModulePathCache(cacheDir: string): Promise<void> {
  const cache = modulePathCaches.get(cacheDir);
  if (!cache) return;

  const indexPath = join(cacheDir, "_index.json");
  const index: Record<string, string> = {};
  for (const [path, cachePath] of cache.entries()) {
    index[path] = cachePath;
  }

  try {
    await getLocalFs().writeTextFile(indexPath, JSON.stringify(index));
  } catch (error) {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to save module index`, error);
  }
}

export function clearModulePathCache(): void {
  modulePathCaches.clear();
  modulePathCacheLoaded.clear();
  verifiedModuleDeps.clear();
  logger.debug(`${LOG_PREFIX_MDX_LOADER} Cleared module path cache`);
}

/**
 * Promise for the most recent disk cleanup operation.
 * Exposed for testing — production callers fire-and-forget.
 */
let _pendingDiskCleanup: Promise<void> = Promise.resolve();

/** Await any in-flight disk cleanup (for testing only). */
export function waitForDiskCleanup(): Promise<void> {
  return _pendingDiskCleanup;
}

export function invalidateModulePaths(changedPaths: string[]): void {
  if (modulePathCaches.size === 0) return;

  let invalidatedCount = 0;
  const staleMjsFiles: string[] = [];
  const affectedCacheDirs = new Set<string>();

  for (const changedPath of changedPaths) {
    const normalizedChanged = changedPath.replace(/^\/+/, "").replace(/\.(tsx?|jsx?|mdx)$/, "");

    for (const [cacheDir, cache] of modulePathCaches.entries()) {
      for (const [cachedKey, cachedFilePath] of cache.entries()) {
        const normalizedCached = cachedKey.replace(/^_vf_modules\//, "").replace(/\.js$/, "");

        if (
          normalizedCached === normalizedChanged ||
          normalizedCached.endsWith(`/${normalizedChanged}`) ||
          normalizedChanged.endsWith(`/${normalizedCached}`)
        ) {
          staleMjsFiles.push(cachedFilePath);
          affectedCacheDirs.add(cacheDir);
          cache.delete(cachedKey);
          // Clear the verified-deps fast-path so lookupMdxEsmCache won't
          // skip validation and serve a deleted .mjs file.
          verifiedModuleDeps.delete(`${cachedFilePath}:${cachedKey}`);
          invalidatedCount++;
          logger.debug(`${LOG_PREFIX_MDX_LOADER} Invalidated module: ${cachedKey}`);
        }
      }
    }
  }

  logger.debug(
    `${LOG_PREFIX_MDX_LOADER} Selective invalidation: ${invalidatedCount} modules for ${changedPaths.length} files`,
  );

  if (invalidatedCount === 0) return;

  // Persist invalidation to disk: update _index.json and delete stale .mjs files.
  // Fire-and-forget so callers aren't blocked, but disk state is eventually consistent.
  // Chain onto previous cleanup to avoid lost operations on rapid sequential invalidation.
  const cleanup = async () => {
    const localFs = getLocalFs();

    // Save updated _index.json for each affected cache dir
    for (const cacheDir of affectedCacheDirs) {
      try {
        await saveModulePathCache(cacheDir);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Persisted _index.json after invalidation`, {
          cacheDir,
        });
      } catch (error) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to persist _index.json after invalidation`, {
          cacheDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Delete stale .mjs files from disk
    for (const mjsPath of staleMjsFiles) {
      try {
        await localFs.remove(mjsPath);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Deleted stale cached module`, { mjsPath });
      } catch (_) {
        /* expected: file may already be gone */
      }
    }
  };
  _pendingDiskCleanup = _pendingDiskCleanup.then(cleanup, cleanup);
}

export async function clearESMDiskCache(): Promise<void> {
  const cacheDir = getMdxEsmCacheDir();
  const fs = getLocalFs();

  try {
    // Remove entire cache directory and recreate it
    // This handles nested project directories like codersociety/local-main/
    await fs.remove(cacheDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Cleared ESM disk cache`);
  } catch (error) {
    if (!isNotFoundError(error)) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to clear ESM disk cache`, error);
    }
  }
}

export async function clearHttpBundleCache(): Promise<void> {
  const cacheDir = getHttpBundleCacheDir();
  const fs = getLocalFs();

  try {
    // Remove entire cache directory and recreate it
    await fs.remove(cacheDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Cleared HTTP bundle cache`);
  } catch (error) {
    if (!isNotFoundError(error)) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to clear HTTP bundle cache`, error);
    }
  }
}

/**
 * Clear all local ESM caches (MDX-ESM disk cache, HTTP bundles, in-memory caches).
 * Call this on server startup to prevent stale module issues.
 */
export async function clearAllLocalCaches(): Promise<void> {
  clearModulePathCache();
  await Promise.all([clearESMDiskCache(), clearHttpBundleCache()]);
  logger.debug(`${LOG_PREFIX_MDX_LOADER} Cleared all local caches`);
}

function toMdxEsmCacheKey(filePath: string, projectDir?: string): string {
  let relativePath = filePath;

  if (projectDir && filePath.startsWith(projectDir)) {
    relativePath = filePath.slice(projectDir.length).replace(/^\/+/, "");
  }

  relativePath = relativePath.replace(/^\/+/, "");
  const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");

  return `v${VERSION}:_vf_modules/${jsPath}`;
}

export async function lookupMdxEsmCache(
  filePath: string,
  cacheDir: string,
  projectDir?: string,
  _contentHash?: string, // Intentionally unused - kept for API compatibility
): Promise<CacheLookupResult> {
  const cache = await getModulePathCache(cacheDir);
  const cacheKey = toMdxEsmCacheKey(filePath, projectDir);

  const cachedPath = cache.get(cacheKey);
  if (!cachedPath) return { status: "miss" };

  const verifyKey = `${cachedPath}:${cacheKey}`;
  if (verifiedModuleDeps.get(verifyKey)) {
    logger.debug(
      `${LOG_PREFIX_MDX_LOADER} SSR reusing MDX-ESM cache (verified): ${filePath} -> ${cachedPath}`,
    );
    return { status: "hit", path: cachedPath };
  }

  try {
    const stat = await getLocalFs().stat(cachedPath);
    if (!stat?.isFile) {
      cache.delete(cacheKey);
      return { status: "corrupted", reason: "Cached file no longer exists on disk", filePath };
    }

    const cachedCode = await getLocalFs().readTextFile(cachedPath);
    if (hasIncompatibleCachePaths(cachedCode)) {
      logger.warn(
        `${LOG_PREFIX_MDX_LOADER} Cached module has incompatible cache paths, invalidating`,
        { filePath, cachedPath },
      );
      cache.delete(cacheKey);

      try {
        await getLocalFs().remove(cachedPath);
      } catch (_) {
        /* expected: cached file may already be removed */
      }

      return {
        status: "corrupted",
        reason: "Incompatible cache paths from different environment",
        filePath,
      };
    }

    // CRITICAL: Check for unresolved /_vf_modules/ imports.
    // These imports should have been resolved to file:// paths during MDX processing.
    // If they're still present, the distributed cache returned stale data that wasn't
    // fully processed, and the import will fail at runtime.
    if (hasUnresolvedVfModules(cachedCode)) {
      logger.warn(
        `${LOG_PREFIX_MDX_LOADER} Cached module has unresolved _vf_modules imports, invalidating`,
        { filePath, cachedPath },
      );
      cache.delete(cacheKey);
      // Delete the stale file so it gets recreated
      try {
        await getLocalFs().remove(cachedPath);
      } catch (_) { /* expected: stale cached file may already be removed */ }
      return {
        status: "corrupted",
        reason: "Unresolved _vf_modules imports in cached code",
        filePath,
      };
    }

    // CRITICAL: Check that all file:// dependencies actually exist on disk.
    // The distributed cache may contain code referencing file:// paths from other pods
    // that don't exist locally (e.g., HTTP bundles, MDX-ESM modules).
    const missingDeps = await findMissingFileDependencies(cachedCode);
    if (missingDeps.length > 0) {
      logger.warn(
        `${LOG_PREFIX_MDX_LOADER} Cached module has ${missingDeps.length} missing file dependencies, invalidating`,
        { filePath, cachedPath, missingDeps: missingDeps.slice(0, 5) },
      );
      cache.delete(cacheKey);
      // Delete the stale file so it gets recreated
      try {
        await getLocalFs().remove(cachedPath);
      } catch (_) { /* expected: stale cached file may already be removed */ }
      return {
        status: "corrupted",
        reason: `Missing file dependencies: ${missingDeps.slice(0, 3).join(", ")}`,
        filePath,
      };
    }

    // Note: We intentionally skip contentHash validation for MDX-ESM cached files.
    // The MDX-ESM cache uses transformed-code hashes in filenames (vfmod-v{VERSION}-{hash}.mjs),
    // while the SSR loader provides source-code hashes. These will never match.
    // The cache version in the key (v{VERSION}:) provides sufficient staleness protection,
    // and the file's existence confirms it's a valid transform for this codebase.
    // This allows both loaders to share the same module instance, preventing
    // duplicate React contexts which break hooks like useContext.

    // P3b: Mark as verified to skip re-stat on subsequent calls
    verifiedModuleDeps.set(verifyKey, true);

    logger.debug(
      `${LOG_PREFIX_MDX_LOADER} SSR reusing MDX-ESM cache: ${filePath} -> ${cachedPath}`,
    );
    return { status: "hit", path: cachedPath };
  } catch (_) {
    /* expected: cached file may be inaccessible or deleted between checks */
    cache.delete(cacheKey);
    return { status: "corrupted", reason: "Cached file inaccessible", filePath };
  }
}
