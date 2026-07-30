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
import { computeHash } from "#veryfront/utils/hash-utils.ts";
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
import {
  computeDependencyCacheIdentity,
} from "#veryfront/transforms/pipeline/dependency-cache-identity.ts";
import { createPipelineReadFile } from "#veryfront/transforms/pipeline/read-file.ts";
import type { DependencyHashCache } from "#veryfront/cache/dependency-graph.ts";

const logger = rendererLogger.component("ssr-module-loader");

export type SSRSourceGraphCacheIdentity =
  | { cacheable: true; hash: string; dependencyHash: string }
  | { cacheable: false; error: unknown };

/**
 * Manages caching concerns for SSR module loading:
 * - Cache key computation and config hashing
 * - Collision-resistant content hashing
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
      const transformConfigHash = computeConfigHashSync({
        reactVersion: this.options.reactVersion,
        dev: this.options.dev,
        apiBaseUrl: this.options.apiBaseUrl,
      });
      const importMapFingerprint = this.options.importMapIdentity?.fingerprint;
      this.cachedConfigHash = importMapFingerprint
        ? `${transformConfigHash}:map-${importMapFingerprint}`
        : transformConfigHash;
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
    return await computeHash(content);
  }

  /**
   * Bind an authored source snapshot to its complete local dependency graph.
   *
   * The transform cache already uses this graph identity. The SSR loader has
   * outer memory, distributed, and disk caches that can return before the
   * transform pipeline runs, so they must use the same dependency boundary or
   * an unchanged parent can retain paths to obsolete child artifacts.
   */
  async getSourceGraphCacheIdentity(
    filePath: string,
    sourceContentHash: string,
    dependencyHashCache: DependencyHashCache,
  ): Promise<SSRSourceGraphCacheIdentity> {
    const dependencyIdentity = await computeDependencyCacheIdentity(
      filePath,
      this.options.projectDir,
      createPipelineReadFile(this.options.adapter, this.options.projectDir),
      dependencyHashCache,
      this.options.importMapIdentity?.importMap,
      this.options.importMapIdentity?.fingerprint,
    );
    if (!dependencyIdentity.cacheable) return dependencyIdentity;
    if (!dependencyIdentity.depsHash) {
      return {
        cacheable: false,
        error: new TypeError("Dependency cache identity did not include a graph hash"),
      };
    }

    return {
      cacheable: true,
      hash: await this.hashContentAsync(
        JSON.stringify([sourceContentHash, dependencyIdentity.depsHash]),
      ),
      dependencyHash: dependencyIdentity.depsHash,
    };
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
    source: "memory-cache" | "distributed-cache",
    options: { checkLocalPaths: boolean; checkInvalidEsmShPath: boolean },
  ): Promise<boolean> {
    if (options.checkInvalidEsmShPath && /esm\.sh\/_?vf_modules\//.test(code)) {
      logger.warn(
        "[SSR-MODULE-LOADER] Distributed cache has invalid esm.sh/_vf_modules URL, re-transforming",
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
          : "[SSR-MODULE-LOADER] Distributed cache has unresolved _vf_modules imports, re-transforming",
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
    source: "memory-cache" | "distributed-cache",
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
        logger.debug("Distributed cache has invalid local path, re-transforming", {
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

    const tmpDir = await buildTmpDirPath(
      baseCacheDir,
      projectId,
      sourceKey,
      RUNTIME_VERSION,
    );

    await this.fs.mkdir(tmpDir, { recursive: true });
    globalTmpDirs.set(cacheKey, tmpDir);
    return tmpDir;
  }
}
