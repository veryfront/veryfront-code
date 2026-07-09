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
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { ensureHttpBundlesExist } from "#veryfront/transforms/esm/http-cache.ts";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { globalModuleCache, globalTmpDirs } from "./cache/index.ts";
import {
  extractAllFilePathsRecursive,
  extractAllHttpBundlePathsRecursive,
  verifiedHttpBundlePaths,
} from "./http-bundle-helpers.ts";
import { buildTempModulePath, buildTmpDirPath, getTmpDirCacheKey } from "./tmp-paths.ts";
import type { ModuleCacheEntry, SSRModuleLoaderOptions } from "./types.ts";
import { ensureMdxModuleDependencies } from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/dependency-recovery.ts";

const logger = rendererLogger.component("ssr-module-loader");

/** Content length threshold: below this, use fast sync hash; above, use async SHA-256 */
const SYNC_HASH_THRESHOLD = 10_000;

/**
 * Manages caching concerns for SSR module loading:
 * - Cache key computation and config hashing
 * - Content hashing (sync for small content, async SHA-256 for large)
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
        dev: this.options.dev,
      });
    }
    return this.cachedConfigHash;
  }

  getCacheKey(filePath: string): string {
    if (!this.options.contentSourceId) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Missing contentSourceId for SSR module cache (project: ${this.options.projectId}, file: ${filePath})`,
      });
    }

    const reactVersion = this.options.reactVersion ?? "default";
    const configHash = this.getConfigHash();

    return buildSSRModuleCacheKey(
      RUNTIME_VERSION,
      this.options.projectId,
      `${this.options.contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
    );
  }

  async hashContentAsync(content: string): Promise<string> {
    if (content.length < SYNC_HASH_THRESHOLD) return hashCodeHex(content);

    try {
      const data = new TextEncoder().encode(content);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray
        .slice(0, 8)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch (_) {
      /* expected: WebCrypto may not be available, fall back to sync hash */
      return hashCodeHex(content);
    }
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
    const sourceId = this.options.contentSourceId;
    if (!sourceId) return !this.options.dev;

    if (sourceId.startsWith("preview-") || sourceId === "preview" || sourceId === "preview-draft") {
      return false;
    }

    if (
      sourceId.startsWith("release-") ||
      sourceId.startsWith("production-") ||
      sourceId.startsWith("prod-") ||
      sourceId === "production"
    ) {
      return true;
    }

    return !this.options.dev;
  }

  async validateCachedCode(
    code: string,
    filePath: string,
    source: "memory-cache" | "redis-cache",
    options: { checkLocalPaths: boolean; checkInvalidEsmShPath: boolean },
  ): Promise<boolean> {
    if (options.checkInvalidEsmShPath && /esm\.sh\/_?vf_modules\//.test(code)) {
      logger.warn(
        "[SSR-MODULE-LOADER] Redis cache has invalid esm.sh/_vf_modules URL, re-transforming",
        {
          file: filePath.slice(-40),
        },
      );
      return false;
    }

    if (await this.hasMissingHttpBundles(code, filePath, source)) {
      return false;
    }

    if (options.checkLocalPaths && await this.hasMissingLocalPaths(code, filePath)) {
      return false;
    }

    if (await this.hasUnresolvedVfModuleImports(code)) {
      logger.warn(
        source === "memory-cache"
          ? "[SSR-MODULE-LOADER] Memory cache has unresolved _vf_modules imports, invalidating"
          : "[SSR-MODULE-LOADER] Redis cache has unresolved _vf_modules imports, re-transforming",
        { file: filePath.slice(-40) },
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
    const verifyKey = `${cachedEntry.tempPath}:${cachedEntry.contentHash}`;
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
      logger.debug("Failed to validate memory cache entry, invalidating", { error });
      this.invalidateContentAndFileCacheEntries(contentCacheKey, filePathCacheKey, cachedEntry);
      return false;
    }
  }

  invalidateFilePathCacheEntry(filePath: string, cacheEntry?: ModuleCacheEntry): void {
    globalModuleCache.delete(this.getCacheKey(filePath));
    if (cacheEntry) {
      this.invalidateMatchingCacheEntries(cacheEntry);
      verifiedHttpBundlePaths.delete(`${cacheEntry.tempPath}:${cacheEntry.contentHash}`);
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
      verifiedHttpBundlePaths.delete(`${cacheEntry.tempPath}:${cacheEntry.contentHash}`);
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

  private async hasMissingHttpBundles(
    code: string,
    filePath: string,
    source: "memory-cache" | "redis-cache",
  ): Promise<boolean> {
    const bundlePaths = await extractAllHttpBundlePathsRecursive(code);
    if (bundlePaths.length === 0) return false;

    const cacheDir = getHttpBundleCacheDir();
    const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
    if (failed.length === 0) return false;

    logger.warn("Unrecoverable HTTP bundles, re-transforming", {
      file: filePath.slice(-40),
      failed,
      totalBundles: bundlePaths.length,
      cacheDir,
      source,
    });
    return true;
  }

  private async hasMissingLocalPaths(code: string, filePath: string): Promise<boolean> {
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
          file: filePath.slice(-40),
          missingPath: path.slice(-60),
          error,
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
          file: filePath.slice(-40),
          recovered: recovered.recovered.slice(0, 5),
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
        detail: `Missing projectId for SSR temp directory (projectDir: ${this.options.projectDir})`,
      });
    }
    if (!contentSourceId) {
      throw INVALID_ARGUMENT.create({
        detail: `Missing contentSourceId for SSR temp directory (project: ${projectId})`,
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
