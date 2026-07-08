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
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { buildMdxEsmPathCacheKey, MDX_ESM_ALL_FILE_URL_PATTERN_SOURCE } from "../cache-format.ts";
import { ensureMdxModuleDependencies } from "../module-fetcher/dependency-recovery.ts";
import { findStaticImportFromSpans } from "../utils/source-spans.ts";
export { getLocalFs } from "./local-fs.ts";
import { getLocalFs } from "./local-fs.ts";

export type CacheLookupResult =
  | { status: "hit"; path: string }
  | { status: "miss" }
  | { status: "corrupted"; reason: string; filePath: string };

const MAX_VERIFIED_MODULE_DEPS = 2_000;
const MAX_MODULE_PATH_CACHE_ENTRIES = 500;

export const verifiedModuleDeps = new LRUCache<string, true>({
  maxEntries: MAX_VERIFIED_MODULE_DEPS,
});

class BoundedModulePathCache extends Map<string, string> {
  constructor(private readonly maxEntries: number) {
    super();
  }

  override set(key: string, value: string): this {
    if (!this.has(key) && this.size >= this.maxEntries) {
      const oldestKey = this.keys().next().value;
      if (oldestKey !== undefined) {
        this.delete(oldestKey);
      }
    }

    return super.set(key, value);
  }
}

/**
 * Check if cached code has file:// paths from a different environment.
 * Checks both HTTP bundle paths and MDX ESM cache paths.
 */
function hasIncompatibleCachePaths(code: string): boolean {
  const localCacheBaseDir = getCacheBaseDir();
  const localHttpCacheDir = getHttpBundleCacheDir();
  const localMdxCacheDir = getMdxEsmCacheDir();
  const pattern = new RegExp(MDX_ESM_ALL_FILE_URL_PATTERN_SOURCE, "gi");

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
  const pattern = new RegExp(MDX_ESM_ALL_FILE_URL_PATTERN_SOURCE, "gi");
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

function matchUnresolvedVfModuleSpecifier(specifier: string): string | null {
  return specifier.match(/^((?:file:\/\/)?\/?\/?_vf_modules\/[^?]+)(?:\?.*)?$/)?.[1] ?? null;
}

/**
 * Check if cached code has unresolved or malformed /_vf_modules/ imports.
 * These should have been resolved to proper file:// paths (e.g., file:///Users/.cache/...).
 * Returns true if any unresolved or malformed imports are found.
 */
function hasUnresolvedVfModules(code: string): boolean {
  const matches = findStaticImportFromSpans(code, matchUnresolvedVfModuleSpecifier);
  const first = matches[0];
  if (first) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Cached module has unresolved _vf_modules import`, {
      importPath: first.path,
    });
    return true;
  }
  return false;
}

const modulePathCaches = new Map<string, Map<string, string>>();
const modulePathCacheLoaded = new Set<string>();

export function getMdxEsmSsrCacheDir(projectId: string, contentSourceId: string): string {
  return join(getMdxEsmCacheDir(), hashCodeHex(projectId), hashCodeHex(contentSourceId));
}

function getModulePathCacheEntryCount(): number {
  let entries = 0;
  for (const cache of modulePathCaches.values()) entries += cache.size;
  return entries;
}

registerCache("mdx-esm-path-caches", () => ({
  name: "mdx-esm-path-caches",
  entries: getModulePathCacheEntryCount(),
  maxEntries: MAX_MODULE_PATH_CACHE_ENTRIES * Math.max(1, modulePathCaches.size),
  cacheDirs: modulePathCaches.size,
}));

registerCache("mdx-esm-verified-deps", () => ({
  name: "mdx-esm-verified-deps",
  entries: verifiedModuleDeps.size,
  maxEntries: MAX_VERIFIED_MODULE_DEPS,
}));

export async function getModulePathCache(cacheDir: string): Promise<Map<string, string>> {
  const existing = modulePathCaches.get(cacheDir);
  if (existing && modulePathCacheLoaded.has(cacheDir)) return existing;

  const cache = existing ?? new BoundedModulePathCache(MAX_MODULE_PATH_CACHE_ENTRIES);
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

/**
 * Persist the given cache dirs' `_index.json` fire-and-forget, chained onto the
 * shared disk-cleanup queue so concurrent invalidations don't clobber each
 * other. Used after an in-memory eviction so the stale pointer does not
 * resurrect from disk on the next process start — callers that drop an entry
 * (e.g. an SSR-only path) may never re-register and re-save it themselves.
 */
function queueIndexPersist(cacheDirs: string[]): void {
  if (cacheDirs.length === 0) return;
  const cleanup = async () => {
    for (const cacheDir of cacheDirs) {
      await saveModulePathCache(cacheDir);
    }
  };
  _pendingDiskCleanup = _pendingDiskCleanup.then(cleanup, cleanup).catch((error) => {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to persist _index.json`, {
      error: error instanceof Error ? error.message : String(error),
    });
  });
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
        const normalizedCached = extractNormalizedCachedModulePath(cachedKey);

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
  _pendingDiskCleanup = _pendingDiskCleanup.then(cleanup, cleanup).catch((error) => {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Disk cleanup failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Invalidate the cached module path for a single source file in a single cache dir.
 *
 * Unlike {@link invalidateModulePaths} (driven by the file watcher on source
 * edits, which also deletes the stale `.mjs` from disk), this is a targeted,
 * synchronous self-heal for the case where a cached module artifact has already
 * gone missing on disk — evicted, or rebuilt under a different content hash by a
 * racing write — while the in-memory path cache and its verified-deps fast-path
 * still point at the stale path. Clearing both forces the next
 * {@link lookupMdxEsmCache} to report a miss so the module is rebuilt instead of
 * handing back a path whose `import()` fails with ERR_MODULE_NOT_FOUND (#2077).
 *
 * `cacheDir` MUST be the dir that produced the missing path. The path-cache key
 * is scoped only by React version + relative module path (not project/source),
 * so two tenants that both have e.g. `app/page.tsx` share the same key in their
 * separate cache dirs — scanning every dir would evict another tenant's valid
 * entry, so the invalidation is confined to the failing dir.
 *
 * The deletion is also persisted to `_index.json` (fire-and-forget, chained onto
 * the shared disk-cleanup queue like {@link invalidateModulePaths}) so the stale
 * pointer does not resurrect from disk on the next process start.
 */
function getMdxEsmCacheDirForCachedPath(cachedPath: string): string | null {
  const baseCacheDir = getMdxEsmCacheDir();
  const prefix = baseCacheDir.endsWith("/") ? baseCacheDir : `${baseCacheDir}/`;
  if (!cachedPath.startsWith(prefix)) return null;

  const [projectKey, sourceKey] = cachedPath.slice(prefix.length).split("/");
  if (!projectKey || !sourceKey) return null;

  return join(baseCacheDir, projectKey, sourceKey);
}

function invalidateMdxEsmModuleFromCache(
  cacheDir: string,
  cache: Map<string, string>,
  filePath: string,
  projectDir?: string,
  reactVersion = REACT_DEFAULT_VERSION,
  expectedCachedPath?: string,
): boolean {
  const cacheKey = toMdxEsmCacheKey(filePath, projectDir, reactVersion);
  const cachedPath = cache.get(cacheKey);
  if (cachedPath === undefined) {
    if (expectedCachedPath) verifiedModuleDeps.delete(`${expectedCachedPath}:${cacheKey}`);
    return false;
  }

  if (expectedCachedPath && cachedPath !== expectedCachedPath) {
    verifiedModuleDeps.delete(`${expectedCachedPath}:${cacheKey}`);
    return false;
  }

  cache.delete(cacheKey);
  verifiedModuleDeps.delete(`${cachedPath}:${cacheKey}`);
  logger.debug(`${LOG_PREFIX_MDX_LOADER} Self-heal invalidated missing module`, {
    filePath,
    cachedPath,
  });

  queueIndexPersist([cacheDir]);
  return true;
}

export function invalidateMdxEsmModule(
  cacheDir: string,
  filePath: string,
  projectDir?: string,
  reactVersion = REACT_DEFAULT_VERSION,
): boolean {
  const cache = modulePathCaches.get(cacheDir);
  if (!cache) return false;

  return invalidateMdxEsmModuleFromCache(cacheDir, cache, filePath, projectDir, reactVersion);
}

export async function invalidateMdxEsmModuleForCachedPath(
  cachedPath: string,
  filePath: string,
  projectDir?: string,
  reactVersion = REACT_DEFAULT_VERSION,
  cacheDir = getMdxEsmCacheDirForCachedPath(cachedPath),
): Promise<boolean> {
  if (!cacheDir) return false;

  const cache = await getModulePathCache(cacheDir);
  return invalidateMdxEsmModuleFromCache(
    cacheDir,
    cache,
    filePath,
    projectDir,
    reactVersion,
    cachedPath,
  );
}

function extractNormalizedCachedModulePath(cachedKey: string): string {
  const normalizedPath = cachedKey.match(/(?:^|:)(_vf_modules\/[^:]+)$/)?.[1] ?? cachedKey;
  return normalizedPath.replace(/^_vf_modules\//, "").replace(/\.js$/, "");
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

export async function clearMdxEsmCacheNamespace(
  projectId: string,
  contentSourceId: string,
): Promise<void> {
  const encodedCacheDir = join(
    getMdxEsmCacheDir(),
    encodeURIComponent(projectId),
    encodeURIComponent(contentSourceId),
  );
  const cacheDirs = new Set([
    encodedCacheDir,
    getMdxEsmSsrCacheDir(projectId, contentSourceId),
  ]);

  for (const cacheDir of cacheDirs) {
    modulePathCaches.delete(cacheDir);
    modulePathCacheLoaded.delete(cacheDir);
  }

  for (const key of Array.from(verifiedModuleDeps.keys())) {
    for (const cacheDir of cacheDirs) {
      if (String(key).startsWith(cacheDir)) {
        verifiedModuleDeps.delete(key);
        break;
      }
    }
  }

  for (const cacheDir of cacheDirs) {
    try {
      await getLocalFs().remove(cacheDir, { recursive: true });
    } catch (error) {
      if (!isNotFoundError(error)) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to remove MDX-ESM cache namespace`, {
          cacheDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      await getLocalFs().mkdir(cacheDir, { recursive: true });
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Cleared MDX-ESM cache namespace`, {
        projectId,
        contentSourceId,
        cacheDir,
      });
    } catch (error) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to recreate MDX-ESM cache namespace`, {
        cacheDir,
        error: error instanceof Error ? error.message : String(error),
      });
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

function toMdxEsmCacheKey(
  filePath: string,
  projectDir?: string,
  reactVersion = REACT_DEFAULT_VERSION,
): string {
  let relativePath = filePath;

  if (projectDir && filePath.startsWith(projectDir)) {
    relativePath = filePath.slice(projectDir.length).replace(/^\/+/, "");
  }

  relativePath = relativePath.replace(/^\/+/, "");
  const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");

  return buildMdxEsmPathCacheKey(`_vf_modules/${jsPath}`, reactVersion);
}

export async function lookupMdxEsmCache(
  filePath: string,
  cacheDir: string,
  projectDir?: string,
  _contentHash?: string, // Intentionally unused - kept for API compatibility
  recoveryOptions?: { projectId: string; contentSourceId: string },
  reactVersion = REACT_DEFAULT_VERSION,
): Promise<CacheLookupResult> {
  const cache = await getModulePathCache(cacheDir);
  const cacheKey = toMdxEsmCacheKey(filePath, projectDir, reactVersion);

  const cachedPath = cache.get(cacheKey);
  if (!cachedPath) return { status: "miss" };

  const verifyKey = `${cachedPath}:${cacheKey}`;
  if (verifiedModuleDeps.get(verifyKey)) {
    // Fast-path: skip the expensive read + content scans for already-verified
    // modules, but still confirm the artifact is present on disk. A cached module
    // can be evicted or rebuilt under a different content hash out from under us
    // (disk-cache eviction, or a racing rebuild) without going through
    // invalidateModulePaths — which is the only thing that clears this marker.
    // Returning the stale path here makes the SSR loader import() a file that no
    // longer exists and hard-fail the whole page render (#2077), so a single stat
    // (far cheaper than the read + regex scans below) guards correctness.
    try {
      const stat = await getLocalFs().stat(cachedPath);
      if (stat?.isFile) {
        logger.debug(
          `${LOG_PREFIX_MDX_LOADER} SSR reusing MDX-ESM cache (verified): ${filePath} -> ${cachedPath}`,
        );
        return { status: "hit", path: cachedPath };
      }
    } catch (_) {
      /* expected: verified artifact was evicted/rebuilt; fall through to invalidate */
    }

    // Artifact is gone — drop the stale markers so the caller rebuilds it, and
    // persist the deletion so it can't resurrect from _index.json on restart
    // (an SSR-only caller may never re-register and re-save this entry itself).
    logger.debug(
      `${LOG_PREFIX_MDX_LOADER} Verified MDX-ESM artifact missing on disk, invalidating`,
      { filePath, cachedPath },
    );
    verifiedModuleDeps.delete(verifyKey);
    cache.delete(cacheKey);
    queueIndexPersist([cacheDir]);
    return { status: "miss" };
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
      } catch (error) {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Stale cached module cleanup failed`, {
          filePath,
          cachedPath,
          error,
        });
      }
      return {
        status: "corrupted",
        reason: "Unresolved _vf_modules imports in cached code",
        filePath,
      };
    }

    // CRITICAL: Check that all file:// dependencies actually exist on disk.
    // The distributed cache may contain code referencing file:// paths from other pods
    // that don't exist locally (e.g., HTTP bundles, MDX-ESM modules).
    let missingDeps = await findMissingFileDependencies(cachedCode);
    if (missingDeps.length > 0 && recoveryOptions) {
      const recovered = await ensureMdxModuleDependencies(cachedCode, {
        ...recoveryOptions,
        log: logger,
      });
      if (recovered.recovered.length > 0) {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Recovered cached MDX-ESM dependencies`, {
          filePath,
          cachedPath,
          recovered: recovered.recovered.slice(0, 5),
        });
      }
      missingDeps = await findMissingFileDependencies(cachedCode);
    }

    if (missingDeps.length > 0) {
      logger.warn(
        `${LOG_PREFIX_MDX_LOADER} Cached module has ${missingDeps.length} missing file dependencies, invalidating`,
        { filePath, cachedPath, missingDeps: missingDeps.slice(0, 5) },
      );
      cache.delete(cacheKey);
      // Delete the stale file so it gets recreated
      try {
        await getLocalFs().remove(cachedPath);
      } catch (error) {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Stale cached module cleanup failed`, {
          filePath,
          cachedPath,
          error,
        });
      }
      return {
        status: "corrupted",
        reason: `Missing file dependencies: ${missingDeps.slice(0, 3).join(", ")}`,
        filePath,
      };
    }

    // Note: We intentionally skip contentHash validation for MDX-ESM cached files.
    // The MDX-ESM cache uses transformed-code hashes in namespaced filenames,
    // while the SSR loader provides source-code hashes. These will never match.
    // The cache namespace in the key provides sufficient staleness protection,
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
