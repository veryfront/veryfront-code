/**
 * SSR Cache Manager
 *
 * Handles cache key computation, content hashing, temp path management,
 * and cached code validation for the SSR module loader.
 *
 * @module module-system/react-loader/ssr-module-loader/ssr-cache-manager
 */

import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { buildSSRModuleCacheKey } from "#veryfront/cache/keys.ts";
import { computeConfigHashSync } from "#veryfront/cache/config-hash.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { rendererLogger } from "#veryfront/utils";
import { ensureHttpBundlesExist } from "#veryfront/transforms/esm/http-cache.ts";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { globalModuleCache, globalTmpDirs } from "./cache/index.ts";
import {
  buildVerifiedHttpBundleKey,
  extractAllFilePathsRecursive,
  extractAllHttpBundlePathsRecursive,
  verifiedHttpBundlePaths,
} from "./http-bundle-helpers.ts";
import { buildTempModulePath, buildTmpDirPath, getTmpDirCacheKey } from "./tmp-paths.ts";
import type { ModuleCacheEntry, SSRModuleLoaderOptions } from "./types.ts";
import { ensureMdxModuleDependencies } from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/dependency-recovery.ts";
import { sha256Short } from "#veryfront/cache/hash.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const logger = rendererLogger.component("ssr-module-loader");
const MAX_CACHE_IDENTITY_LENGTH = 8_192;
const MAX_CACHED_MODULE_BYTES = 10 * 1024 * 1024;

function validateCacheIdentity(value: string, label: string): void {
  if (
    value.length === 0 || value.length > MAX_CACHE_IDENTITY_LENGTH ||
    hasUnsafeControlCharacters(value)
  ) {
    throw INVALID_ARGUMENT.create({ detail: `${label} is invalid` });
  }
}

/**
 * Manages caching concerns for SSR module loading:
 * - Cache key computation and config hashing
 * - Content hashing with SHA-256
 * - Temp file path management
 * - Cached code validation (HTTP bundles, local paths, VF module imports)
 * - Cache entry invalidation
 */
export class SSRCacheManager {
  private fs = createFileSystem();
  private cachedConfigHash: string | undefined;

  constructor(private options: SSRModuleLoaderOptions) {}

  /** Lazily compute config hash once per manager instance. */
  getConfigHash(): string {
    if (!this.cachedConfigHash) {
      this.cachedConfigHash = computeConfigHashSync({
        reactVersion: this.options.reactVersion,
        dev: this.options.dev || this.options.mode === "preview",
      });
    }
    return this.cachedConfigHash;
  }

  getCacheKey(filePath: string): string {
    return this.buildCacheKey(["path", filePath], filePath);
  }

  getContentCacheKey(filePath: string, contentHash: string): string {
    validateCacheIdentity(contentHash, "contentHash");
    return this.buildCacheKey(["content", filePath, contentHash], filePath);
  }

  private buildCacheKey(identity: readonly string[], filePath: string): string {
    if (!this.options.contentSourceId) {
      throw INVALID_ARGUMENT.create({
        detail: "Missing contentSourceId for SSR module cache",
      });
    }

    const reactVersion = this.options.reactVersion ?? "default";
    const configHash = this.getConfigHash();
    validateCacheIdentity(this.options.projectId, "projectId");
    validateCacheIdentity(this.options.contentSourceId, "contentSourceId");
    validateCacheIdentity(reactVersion, "reactVersion");
    validateCacheIdentity(filePath, "filePath");

    return buildSSRModuleCacheKey(
      RUNTIME_VERSION,
      this.options.projectId,
      JSON.stringify([this.options.contentSourceId, reactVersion, configHash, identity]),
    );
  }

  async hashContentAsync(content: string): Promise<string> {
    return await sha256Short(content);
  }

  async getTempPath(filePath: string, contentHash?: string): Promise<string> {
    const tmpDir = await this.ensureTmpDir();
    return buildTempModulePath(
      tmpDir,
      filePath,
      this.options.projectDir,
      RUNTIME_VERSION,
      contentHash,
    );
  }

  isProductionContentSource(): boolean {
    if (this.options.mode === "production") return true;
    if (this.options.mode === "preview" || this.options.mode === "development") return false;
    return !this.options.dev;
  }

  async validateCachedCode(
    code: string,
    _filePath: string,
    source: "memory-cache" | "redis-cache",
    options: { checkLocalPaths: boolean; checkInvalidEsmShPath: boolean },
  ): Promise<boolean> {
    if (new TextEncoder().encode(code).byteLength > MAX_CACHED_MODULE_BYTES) {
      logger.warn("SSR module cache entry exceeds size limit", { source });
      return false;
    }
    if (options.checkInvalidEsmShPath && await this.hasInvalidEsmShVfModuleImport(code)) {
      logger.warn("Distributed cache contains an invalid runtime module URL");
      return false;
    }

    if (await this.hasMissingHttpBundles(code, source)) {
      return false;
    }

    if (options.checkLocalPaths && await this.hasMissingLocalPaths(code)) {
      return false;
    }

    if (await this.hasUnresolvedVfModuleImports(code)) {
      logger.warn(
        source === "memory-cache"
          ? "Memory cache contains unresolved runtime module imports"
          : "Distributed cache contains unresolved runtime module imports",
      );
      return false;
    }

    return true;
  }

  async validateMemoryCacheEntry(
    cachedEntry: ModuleCacheEntry,
    contentCacheKey: string,
    filePathCacheKey: string,
    filePath: string,
  ): Promise<boolean> {
    const verifyKey = buildVerifiedHttpBundleKey(
      cachedEntry.tempPath,
      cachedEntry.contentHash,
    );
    if (verifiedHttpBundlePaths.get(verifyKey)) return globalModuleCache.has(contentCacheKey);

    try {
      const cachedCode = await this.fs.readTextFile(cachedEntry.tempPath);
      const isValid = await this.validateCachedCode(cachedCode, filePath, "memory-cache", {
        checkLocalPaths: true,
        checkInvalidEsmShPath: false,
      });
      if (!isValid) {
        this.invalidateContentAndFileCacheEntries(contentCacheKey, filePathCacheKey, cachedEntry);
        return false;
      }
      verifiedHttpBundlePaths.set(verifyKey, true);
      return globalModuleCache.has(contentCacheKey);
    } catch (error) {
      logger.debug("Failed to validate memory cache entry, invalidating", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      this.invalidateContentAndFileCacheEntries(contentCacheKey, filePathCacheKey, cachedEntry);
      return false;
    }
  }

  invalidateFilePathCacheEntry(filePath: string, cacheEntry?: ModuleCacheEntry): void {
    globalModuleCache.delete(this.getCacheKey(filePath));
    if (cacheEntry) {
      this.invalidateMatchingCacheEntries(cacheEntry);
      verifiedHttpBundlePaths.delete(
        buildVerifiedHttpBundleKey(cacheEntry.tempPath, cacheEntry.contentHash),
      );
    }
  }

  invalidateContentAndFileCacheEntries(
    contentCacheKey: string,
    filePathCacheKey: string,
    cacheEntry?: ModuleCacheEntry,
  ): void {
    globalModuleCache.delete(contentCacheKey);
    globalModuleCache.delete(filePathCacheKey);
    if (cacheEntry) {
      verifiedHttpBundlePaths.delete(
        buildVerifiedHttpBundleKey(cacheEntry.tempPath, cacheEntry.contentHash),
      );
    }
  }

  private invalidateMatchingCacheEntries(cacheEntry: ModuleCacheEntry): void {
    const keysToDelete: string[] = [];
    for (const [key, entry] of globalModuleCache.entries()) {
      if (
        entry.tempPath === cacheEntry.tempPath &&
        entry.contentHash === cacheEntry.contentHash
      ) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      globalModuleCache.delete(key);
    }
  }

  /** Get the filesystem instance for external callers. */
  getFs(): ReturnType<typeof createFileSystem> {
    return this.fs;
  }

  private async hasUnresolvedVfModuleImports(code: string): Promise<boolean> {
    const imports = await parseImports(code);
    return imports.some((importSpecifier) => {
      const rawPath = importSpecifier.n;
      if (!rawPath) return false;

      const path = rawPath.replace(/^(?:file:\/\/)?\/+/, "");
      return path.startsWith("_vf_modules/");
    });
  }

  private async hasInvalidEsmShVfModuleImport(code: string): Promise<boolean> {
    const imports = await parseImports(code);
    return imports.some((importSpecifier) => {
      const specifier = importSpecifier.n;
      if (!specifier?.startsWith("https://") && !specifier?.startsWith("http://")) {
        return false;
      }
      try {
        const url = new URL(specifier);
        return url.hostname === "esm.sh" &&
          (url.pathname.startsWith("/_vf_modules/") ||
            url.pathname.startsWith("/vf_modules/"));
      } catch {
        return false;
      }
    });
  }

  private async hasMissingHttpBundles(
    code: string,
    source: "memory-cache" | "redis-cache",
  ): Promise<boolean> {
    const bundlePaths = await extractAllHttpBundlePathsRecursive(code);
    if (bundlePaths.length === 0) return false;

    const cacheDir = getHttpBundleCacheDir();
    const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
    if (failed.length === 0) return false;

    logger.warn("Unrecoverable HTTP bundles, re-transforming", {
      failedCount: failed.length,
      totalBundles: bundlePaths.length,
      source,
    });
    return true;
  }

  private async hasMissingLocalPaths(code: string): Promise<boolean> {
    const allPaths = await extractAllFilePathsRecursive(code);
    let firstMissingPathIndex = -1;

    for (let index = 0; index < allPaths.length; index++) {
      const path = allPaths[index]!;
      try {
        const stat = await this.fs.stat(path);
        if (!stat.isFile) {
          firstMissingPathIndex = index;
          break;
        }
      } catch (error) {
        logger.debug("Redis cache has invalid local path, re-transforming", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        firstMissingPathIndex = index;
        break;
      }
    }

    if (firstMissingPathIndex === -1) return false;

    if (
      this.options.projectId &&
      this.options.contentSourceId
    ) {
      const recovered = await ensureMdxModuleDependencies(code, {
        projectId: this.options.projectId,
        contentSourceId: this.options.contentSourceId,
        log: logger,
      });
      if (recovered.recovered.length > 0) {
        logger.debug("Recovered missing local vfmod dependencies for SSR cache entry", {
          recoveredCount: recovered.recovered.length,
        });
      }
    }

    for (let index = firstMissingPathIndex; index < allPaths.length; index++) {
      const path = allPaths[index]!;
      try {
        const stat = await this.fs.stat(path);
        if (!stat.isFile) return true;
      } catch (_) {
        return true;
      }
    }

    return false;
  }

  private async ensureTmpDir(): Promise<string> {
    const { projectId, contentSourceId } = this.options;

    if (!projectId) {
      throw INVALID_ARGUMENT.create({
        detail: "Missing projectId for SSR temp directory",
      });
    }
    if (!contentSourceId) {
      throw INVALID_ARGUMENT.create({
        detail: "Missing contentSourceId for SSR temp directory",
      });
    }

    const baseCacheDir = getMdxEsmCacheDir();
    const sourceKey = contentSourceId;
    const cacheKey = getTmpDirCacheKey(baseCacheDir, projectId, sourceKey, RUNTIME_VERSION);

    const existingDir = globalTmpDirs.get(cacheKey);
    if (existingDir) return existingDir;

    const tmpDir = buildTmpDirPath(baseCacheDir, projectId, sourceKey, RUNTIME_VERSION);

    await this.fs.mkdir(tmpDir, { recursive: true });
    globalTmpDirs.set(cacheKey, tmpDir);
    return tmpDir;
  }
}
