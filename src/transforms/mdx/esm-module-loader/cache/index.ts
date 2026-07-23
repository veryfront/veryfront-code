/****
 * ESM Module Cache Operations
 *
 * Manages persistent module path caching for ESM module loading.
 *
 * @module build/transforms/mdx/esm-module-loader/cache
 */

import { basename, dirname, join, resolve } from "#veryfront/compat/path";
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
import {
  buildMdxEsmPathCacheKey,
  MDX_ESM_ALL_FILE_URL_PATTERN_SOURCE,
  MDX_ESM_CACHE_NAMESPACE,
} from "../cache-format.ts";
import { ensureMdxModuleDependencies } from "../module-fetcher/dependency-recovery.ts";
import { hashString } from "../utils/hash.ts";
import {
  MAX_MDX_MODULE_CODE_BYTES,
  utf8ByteLength,
} from "../module-fetcher/recovery-payload.ts";
import { findStaticImportFromSpans } from "../utils/source-spans.ts";
import {
  formatCacheVersionSegment,
  isCacheVersionSegment,
} from "#veryfront/utils/cache-version.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";
import {
  getMdxEsmSsrCacheDir,
  getMdxEsmSsrCacheDirs,
} from "../cache-paths.ts";
export {
  getMdxEsmSsrCacheDir,
  getMdxEsmSsrCacheDirs,
} from "../cache-paths.ts";
export { getLocalFs } from "./local-fs.ts";
import { getLocalFs } from "./local-fs.ts";

export type CacheLookupResult =
  | { status: "hit"; path: string }
  | { status: "miss" }
  | { status: "corrupted"; reason: string; filePath: string };

const MAX_VERIFIED_MODULE_DEPS = 2_000;
const MAX_MODULE_PATH_CACHE_ENTRIES = 500;
const MAX_MODULE_PATH_CACHE_DIRS = 128;
const MAX_MODULE_INDEX_BYTES = 1024 * 1024;
const MAX_MODULE_ARTIFACTS_PER_DIR = 2_000;
const MAX_MODULE_ARTIFACT_BYTES_PER_DIR = 512 * 1024 * 1024;

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

export function isSafeModuleArtifactPath(cacheDir: string, artifactPath: string): boolean {
  const resolvedCacheDir = resolve(cacheDir);
  const resolvedArtifactPath = resolve(artifactPath);
  const fileName = basename(resolvedArtifactPath);
  return dirname(resolvedArtifactPath) === resolvedCacheDir &&
    fileName.length <= 240 &&
    /^[A-Za-z0-9._-]+\.mjs$/.test(fileName);
}

function touchModulePathCacheDir(cacheDir: string, cache: Map<string, string>): void {
  modulePathCaches.delete(cacheDir);
  modulePathCaches.set(cacheDir, cache);
}

function evictOldestModulePathCacheDir(): void {
  if (modulePathCaches.size < MAX_MODULE_PATH_CACHE_DIRS) return;
  const oldestCacheDir = modulePathCaches.keys().next().value;
  if (oldestCacheDir === undefined) return;
  modulePathCaches.delete(oldestCacheDir);
  modulePathCacheLoaded.delete(oldestCacheDir);
}

async function pruneOrphanedModuleArtifacts(
  cacheDir: string,
  cache: Map<string, string>,
): Promise<void> {
  const localFs = getLocalFs();
  const referenced = new Set(
    [...cache.values()]
      .filter((artifactPath) => isSafeModuleArtifactPath(cacheDir, artifactPath))
      .map((artifactPath) => resolve(artifactPath)),
  );

  const artifacts: Array<{
    path: string;
    size: number;
    modifiedAt: number;
    referenced: boolean;
  }> = [];
  try {
    for await (const entry of localFs.readDir(cacheDir)) {
      if (!entry.isFile || !/^[A-Za-z0-9._-]+\.mjs$/.test(entry.name)) {
        continue;
      }
      const artifactPath = join(cacheDir, entry.name);
      const stat = await localFs.stat(artifactPath);
      if (!stat?.isFile) continue;
      artifacts.push({
        path: artifactPath,
        size: Math.max(0, stat.size ?? 0),
        modifiedAt: stat.mtime?.getTime() ?? 0,
        referenced: referenced.has(resolve(artifactPath)),
      });
    }

    let artifactCount = artifacts.length;
    let artifactBytes = artifacts.reduce((total, artifact) => total + artifact.size, 0);
    if (
      artifactCount <= MAX_MODULE_ARTIFACTS_PER_DIR &&
      artifactBytes <= MAX_MODULE_ARTIFACT_BYTES_PER_DIR
    ) {
      return;
    }

    // A recovered dependency may be referenced by another cached module without
    // having its own path-index entry. Never treat every unindexed file as an
    // orphan: only evict the oldest unreferenced artifacts once the directory is
    // actually over its hard count/byte bounds.
    const candidates = artifacts
      .filter((artifact) => !artifact.referenced)
      .sort((left, right) => left.modifiedAt - right.modifiedAt);
    for (const artifact of candidates) {
      if (
        artifactCount <= MAX_MODULE_ARTIFACTS_PER_DIR &&
        artifactBytes <= MAX_MODULE_ARTIFACT_BYTES_PER_DIR
      ) {
        break;
      }
      await localFs.remove(artifact.path);
      artifactCount--;
      artifactBytes -= artifact.size;
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to prune orphaned module artifacts`, {
        cacheDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
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
  if (existing && modulePathCacheLoaded.has(cacheDir)) {
    touchModulePathCacheDir(cacheDir, existing);
    return existing;
  }

  const cache = existing ?? new BoundedModulePathCache(MAX_MODULE_PATH_CACHE_ENTRIES);
  if (!existing) evictOldestModulePathCacheDir();
  modulePathCaches.set(cacheDir, cache);

  const indexPath = join(cacheDir, "_index.json");

  try {
    const stat = await getLocalFs().stat(indexPath);
    if (!stat?.isFile || (stat.size ?? 0) > MAX_MODULE_INDEX_BYTES) {
      throw new Error("Invalid or oversized MDX module index");
    }
    const content = await getLocalFs().readTextFile(indexPath);
    const index: unknown = JSON.parse(content);
    if (!index || typeof index !== "object" || Array.isArray(index)) {
      throw new Error("Invalid MDX module index shape");
    }
    for (const [path, cachePath] of Object.entries(index)) {
      if (
        typeof cachePath !== "string" ||
        !parseMdxEsmPathCacheKey(path) ||
        !isSafeModuleArtifactPath(cacheDir, cachePath)
      ) {
        continue;
      }
      cache.set(path, cachePath);
    }
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Loaded module index: ${cache.size} entries`);
  } catch (_) {
    /* expected: _index.json may not exist yet */
  }

  modulePathCacheLoaded.add(cacheDir);
  await pruneOrphanedModuleArtifacts(cacheDir, cache);
  return cache;
}

export async function saveModulePathCache(cacheDir: string): Promise<void> {
  const cache = modulePathCaches.get(cacheDir);
  if (!cache) return;

  const indexPath = join(cacheDir, "_index.json");
  const index: Record<string, string> = {};
  for (const [path, cachePath] of cache.entries()) {
    if (!parseMdxEsmPathCacheKey(path) || !isSafeModuleArtifactPath(cacheDir, cachePath)) continue;
    index[path] = cachePath;
  }

  try {
    await getLocalFs().writeTextFile(indexPath, JSON.stringify(index));
    await pruneOrphanedModuleArtifacts(cacheDir, cache);
  } catch (error) {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to save module index`, error);
    throw error;
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

export async function invalidateModulePaths(changedPaths: string[]): Promise<void> {
  if (modulePathCaches.size === 0) return;

  let invalidatedCount = 0;
  const staleMjsFiles = new Set<string>();
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
          if (isSafeModuleArtifactPath(cacheDir, cachedFilePath)) {
            staleMjsFiles.add(cachedFilePath);
          }
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

  // Persist invalidation before the caller broadcasts a reload. This prevents a
  // concurrent request or a process restart from resurrecting the stale module
  // after the in-memory entry has already been removed.
  const cleanup = async () => {
    const localFs = getLocalFs();
    const failures: unknown[] = [];

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
        failures.push(error);
      }
    }

    // Delete stale .mjs files from disk
    for (const mjsPath of staleMjsFiles) {
      try {
        await localFs.remove(mjsPath);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Deleted stale cached module`, { mjsPath });
      } catch (error) {
        if (!isNotFoundError(error)) {
          logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to delete stale cached module`, {
            mjsPath,
            error: error instanceof Error ? error.message : String(error),
          });
          failures.push(error);
        }
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, "MDX-ESM module invalidation did not fully persist");
    }
  };

  const operation = _pendingDiskCleanup.then(cleanup, cleanup);
  _pendingDiskCleanup = operation.catch((error) => {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Disk cleanup failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  await operation;
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

  const parts = cachedPath.slice(prefix.length).split("/");
  const [maybeVersionKey, maybeProjectKey, maybeSourceKey] = parts;
  if (
    !maybeVersionKey ||
    !isCacheVersionSegment(maybeVersionKey) ||
    !maybeProjectKey ||
    !maybeSourceKey ||
    !/^[a-f0-9]{64}$/.test(maybeProjectKey) ||
    !/^[a-f0-9]{64}$/.test(maybeSourceKey)
  ) {
    return null;
  }

  return join(baseCacheDir, maybeVersionKey, maybeProjectKey, maybeSourceKey);
}

function isSameOrDescendantPath(path: string, parentPath: string): boolean {
  const normalizedParent = parentPath.replace(/\/+$/, "");
  const normalizedPath = path.replace(/\/+$/, "");
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

function invalidateMdxEsmModuleFromCache(
  cacheDir: string,
  cache: Map<string, string>,
  filePath: string,
  projectDir?: string,
  reactVersion = REACT_DEFAULT_VERSION,
  expectedCachedPath?: string,
): boolean {
  const target = parseMdxEsmPathCacheKey(
    toMdxEsmCacheKey(filePath, projectDir, reactVersion),
  );
  if (!target) return false;

  let invalidated = false;
  for (const [cacheKey, cachedPath] of cache.entries()) {
    const parsed = parseMdxEsmPathCacheKey(cacheKey);
    if (
      !parsed ||
      parsed.reactVersion !== target.reactVersion ||
      parsed.normalizedPath !== target.normalizedPath
    ) {
      continue;
    }
    if (expectedCachedPath && cachedPath !== expectedCachedPath) continue;

    cache.delete(cacheKey);
    verifiedModuleDeps.delete(`${cachedPath}:${cacheKey}`);
    invalidated = true;
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Self-heal invalidated missing module`, {
      filePath,
      cachedPath,
    });
  }

  if (invalidated) queueIndexPersist([cacheDir]);
  return invalidated;
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
  cacheDirs: string | string[] | null = getMdxEsmCacheDirForCachedPath(cachedPath),
): Promise<boolean> {
  const derivedCacheDir = getMdxEsmCacheDirForCachedPath(cachedPath);
  const configuredDirs = Array.isArray(cacheDirs) ? cacheDirs : cacheDirs ? [cacheDirs] : [];
  const candidateDirs = [
    ...(derivedCacheDir ? [derivedCacheDir] : []),
    ...configuredDirs,
  ].filter((cacheDir, index, dirs) => dirs.indexOf(cacheDir) === index);
  if (candidateDirs.length === 0) return false;

  for (const cacheDir of candidateDirs) {
    const cache = await getModulePathCache(cacheDir);
    const invalidated = invalidateMdxEsmModuleFromCache(
      cacheDir,
      cache,
      filePath,
      projectDir,
      reactVersion,
      cachedPath,
    );
    if (invalidated) return true;
  }

  return false;
}

function extractNormalizedCachedModulePath(cachedKey: string): string {
  const normalizedPath = parseMdxEsmPathCacheKey(cachedKey)?.normalizedPath ?? cachedKey;
  return normalizedPath.replace(/^_vf_modules\//, "").replace(/\.js$/, "");
}

interface ParsedMdxEsmPathCacheKey {
  reactVersion: string;
  normalizedPath: string;
  sourceContentHash: string | null;
}

function parseMdxEsmPathCacheKey(cacheKey: string): ParsedMdxEsmPathCacheKey | null {
  const prefix = `${MDX_ESM_CACHE_NAMESPACE}:path:`;
  if (!cacheKey.startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(cacheKey.slice(prefix.length));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 3 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string" ||
      (parsed[2] !== null && typeof parsed[2] !== "string") ||
      parsed[0].length === 0 ||
      parsed[0].length > 64 ||
      parsed[1].length === 0 ||
      parsed[1].length > 4096 ||
      parsed[1].includes("\0") ||
      parsed[1].split("/").some((segment: string) => segment === "." || segment === "..") ||
      (parsed[2] !== null && !/^[a-f0-9]{64}$/.test(parsed[2]))
    ) {
      return null;
    }
    return {
      reactVersion: parsed[0],
      normalizedPath: parsed[1],
      sourceContentHash: parsed[2],
    };
  } catch (_) {
    return null;
  }
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
  const failures: unknown[] = [];
  const currentSsrCacheDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
  const cacheDirs = new Set([currentSsrCacheDir]);
  const removeDirs = new Set(getMdxEsmSsrCacheDirs(projectId, contentSourceId));
  const affectedCacheDirs = new Set(removeDirs);

  for (const loadedCacheDir of modulePathCaches.keys()) {
    for (const cacheDir of removeDirs) {
      if (isSameOrDescendantPath(loadedCacheDir, cacheDir)) {
        affectedCacheDirs.add(loadedCacheDir);
        break;
      }
    }
  }

  for (const cacheDir of affectedCacheDirs) {
    modulePathCaches.delete(cacheDir);
    modulePathCacheLoaded.delete(cacheDir);
  }

  for (const key of Array.from(verifiedModuleDeps.keys())) {
    for (const cacheDir of removeDirs) {
      if (isSameOrDescendantPath(String(key), cacheDir)) {
        verifiedModuleDeps.delete(key);
        break;
      }
    }
  }

  for (const cacheDir of removeDirs) {
    try {
      await getLocalFs().remove(cacheDir, { recursive: true });
    } catch (error) {
      if (!isNotFoundError(error)) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to remove MDX-ESM cache namespace`, {
          cacheDir,
          error: error instanceof Error ? error.message : String(error),
        });
        failures.push(error);
      }
    }

    if (!cacheDirs.has(cacheDir)) continue;

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
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Failed to clear MDX-ESM cache namespace for project ${projectId}`,
    );
  }
}

/**
 * Clear every loaded and persisted MDX-ESM content-source namespace owned by
 * one project. This is used only for explicit all-environment invalidation;
 * environment-scoped callers should use {@link clearMdxEsmCacheNamespace}.
 */
export async function clearMdxEsmCacheNamespacesForProject(projectId: string): Promise<void> {
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new TypeError("A non-empty projectId is required for MDX-ESM project invalidation");
  }

  const baseDir = getMdxEsmCacheDir();
  const projectHash = hashString(projectId);
  const projectRoots = new Set([
    join(baseDir, formatCacheVersionSegment(RUNTIME_VERSION), projectHash),
  ]);
  const affectedCacheDirs = new Set(projectRoots);

  for (const loadedCacheDir of modulePathCaches.keys()) {
    if ([...projectRoots].some((root) => isSameOrDescendantPath(loadedCacheDir, root))) {
      affectedCacheDirs.add(loadedCacheDir);
    }
  }
  for (const cacheDir of affectedCacheDirs) {
    modulePathCaches.delete(cacheDir);
    modulePathCacheLoaded.delete(cacheDir);
  }
  for (const key of Array.from(verifiedModuleDeps.keys())) {
    if ([...projectRoots].some((root) => isSameOrDescendantPath(String(key), root))) {
      verifiedModuleDeps.delete(key);
    }
  }

  const failures: unknown[] = [];
  for (const projectRoot of projectRoots) {
    try {
      await getLocalFs().remove(projectRoot, { recursive: true });
    } catch (error) {
      if (!isNotFoundError(error)) {
        failures.push(error);
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to remove project MDX-ESM namespaces`, {
          projectId,
          projectRoot,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Failed to clear every MDX-ESM namespace for project ${projectId}`,
    );
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
  sourceContentHash?: string,
): string {
  let relativePath = filePath;

  if (projectDir && filePath.startsWith(projectDir)) {
    relativePath = filePath.slice(projectDir.length).replace(/^\/+/, "");
  }

  relativePath = relativePath.replace(/^\/+/, "");
  const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");

  return buildMdxEsmPathCacheKey(`_vf_modules/${jsPath}`, reactVersion, sourceContentHash);
}

export async function lookupMdxEsmCache(
  filePath: string,
  cacheDir: string,
  projectDir?: string,
  contentHash?: string,
  recoveryOptions?: { projectId: string; contentSourceId: string },
  reactVersion = REACT_DEFAULT_VERSION,
): Promise<CacheLookupResult> {
  const cache = await getModulePathCache(cacheDir);
  const cacheKey = toMdxEsmCacheKey(filePath, projectDir, reactVersion, contentHash);

  const cachedPath = cache.get(cacheKey);
  if (!cachedPath) return { status: "miss" };
  if (!isSafeModuleArtifactPath(cacheDir, cachedPath)) {
    cache.delete(cacheKey);
    queueIndexPersist([cacheDir]);
    return { status: "corrupted", reason: "Cached path escapes its namespace", filePath };
  }

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
      if (stat?.isFile && (stat.size ?? 0) <= MAX_MDX_MODULE_CODE_BYTES) {
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
    if (!stat?.isFile || (stat.size ?? 0) > MAX_MDX_MODULE_CODE_BYTES) {
      cache.delete(cacheKey);
      return {
        status: "corrupted",
        reason: stat?.isFile ? "Cached file exceeds size limit" : "Cached file no longer exists on disk",
        filePath,
      };
    }

    const cachedCode = await getLocalFs().readTextFile(cachedPath);
    if (utf8ByteLength(cachedCode) > MAX_MDX_MODULE_CODE_BYTES) {
      cache.delete(cacheKey);
      return { status: "corrupted", reason: "Cached code exceeds size limit", filePath };
    }
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

    // The path-cache key is bound to the caller's full source-content digest.
    // This lets both loaders share the same module instance while preventing a
    // missed watcher event or process restart from serving an older transform.

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
