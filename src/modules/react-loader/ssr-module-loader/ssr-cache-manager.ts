/**
 * SSR Cache Manager
 *
 * Handles cache key computation, content hashing, temp path management,
 * and cached code validation for the SSR module loader.
 *
 * @module module-system/react-loader/ssr-module-loader/ssr-cache-manager
 */

import { VERSION } from "#veryfront/utils/version.ts";
import { buildSSRModuleCacheKey } from "#veryfront/cache/keys.ts";
import { computeConfigHashSync } from "#veryfront/cache/config-hash.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { ensureHttpBundlesExist } from "#veryfront/transforms/esm/http-cache.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { globalModuleCache, globalTmpDirs } from "./cache/index.ts";
import {
  extractAllFilePaths,
  extractHttpBundlePaths,
  verifiedHttpBundlePaths,
} from "./http-bundle-helpers.ts";
import { buildTempModulePath, buildTmpDirPath, getTmpDirCacheKey } from "./tmp-paths.ts";
import type { ModuleCacheEntry, SSRModuleLoaderOptions } from "./types.ts";

const log = logger.component("ssr-module-loader");

const UNRESOLVED_VF_MODULE_IMPORT_PATTERN =
  /from\s*["']((?:file:\/\/)?\/?\/?_vf_modules\/[^"']+)["']/;

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
      throw new Error(
        `Missing contentSourceId for SSR module cache (project: ${this.options.projectId}, file: ${filePath})`,
      );
    }

    const reactVersion = this.options.reactVersion ?? "default";
    const configHash = this.getConfigHash();

    return buildSSRModuleCacheKey(
      VERSION,
      this.options.projectId,
      `${this.options.contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
    );
  }

  async hashContentAsync(content: string): Promise<string> {
    if (content.length < 10000) return hashCodeHex(content);

    try {
      const data = new TextEncoder().encode(content);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray
        .slice(0, 8)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      return hashCodeHex(content);
    }
  }

  async getTempPath(filePath: string, contentHash?: string): Promise<string> {
    const tmpDir = await this.ensureTmpDir();
    return buildTempModulePath(tmpDir, filePath, this.options.projectDir, VERSION, contentHash);
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

    if (this.hasUnresolvedVfModuleImports(code)) {
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
        checkLocalPaths: false,
        checkInvalidEsmShPath: false,
      });
      if (!isValid) {
        this.invalidateContentAndFileCacheEntries(contentCacheKey, filePathCacheKey, cachedEntry);
        return false;
      }
      verifiedHttpBundlePaths.set(verifyKey, true);
      return globalModuleCache.has(contentCacheKey);
    } catch {
      this.invalidateContentAndFileCacheEntries(contentCacheKey, filePathCacheKey, cachedEntry);
      return false;
    }
  }

  invalidateFilePathCacheEntry(filePath: string, cacheEntry?: ModuleCacheEntry): void {
    globalModuleCache.delete(this.getCacheKey(filePath));
    if (cacheEntry) {
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

  /** Get the filesystem instance for external callers. */
  getFs(): ReturnType<typeof createFileSystem> {
    return this.fs;
  }

  private hasUnresolvedVfModuleImports(code: string): boolean {
    return UNRESOLVED_VF_MODULE_IMPORT_PATTERN.test(code);
  }

  private async hasMissingHttpBundles(
    code: string,
    filePath: string,
    source: "memory-cache" | "redis-cache",
  ): Promise<boolean> {
    const bundlePaths = extractHttpBundlePaths(code);
    if (bundlePaths.length === 0) return false;

    const cacheDir = getHttpBundleCacheDir();
    const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
    if (failed.length === 0) return false;

    log.warn("Unrecoverable HTTP bundles, re-transforming", {
      file: filePath.slice(-40),
      failed,
      totalBundles: bundlePaths.length,
      cacheDir,
      source,
    });
    return true;
  }

  private async hasMissingLocalPaths(code: string, filePath: string): Promise<boolean> {
    const allPaths = extractAllFilePaths(code);
    for (const path of allPaths) {
      try {
        const stat = await this.fs.stat(path);
        if (!stat.isFile) {
          return true;
        }
      } catch {
        log.debug("Redis cache has invalid local path, re-transforming", {
          file: filePath.slice(-40),
          missingPath: path.slice(-60),
        });
        return true;
      }
    }

    return false;
  }

  private async ensureTmpDir(): Promise<string> {
    const { projectId, contentSourceId } = this.options;

    if (!projectId) {
      throw new Error(
        `Missing projectId for SSR temp directory (projectDir: ${this.options.projectDir})`,
      );
    }
    if (!contentSourceId) {
      throw new Error(`Missing contentSourceId for SSR temp directory (project: ${projectId})`);
    }

    const baseCacheDir = getMdxEsmCacheDir();
    const sourceKey = contentSourceId;
    const cacheKey = getTmpDirCacheKey(baseCacheDir, projectId, sourceKey);

    const existingDir = globalTmpDirs.get(cacheKey);
    if (existingDir) return existingDir;

    const tmpDir = buildTmpDirPath(baseCacheDir, projectId, sourceKey);

    await this.fs.mkdir(tmpDir, { recursive: true });
    globalTmpDirs.set(cacheKey, tmpDir);
    return tmpDir;
  }
}
