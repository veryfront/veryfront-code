/**
 * SSR Module Loader Class
 *
 * Loads and transforms React components for server-side rendering.
 *
 * @module module-system/react-loader/ssr-module-loader/loader
 */

import { join } from "#veryfront/platform/compat/path/index.ts";
import type * as React from "react";
import { transformToESM } from "#veryfront/transforms/esm/index.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import { TRANSFORM_CACHE_VERSION } from "#veryfront/transforms/esm/package-registry.ts";
import { buildSSRModuleCacheKey } from "../../../cache/keys.ts";
import { computeConfigHashSync } from "../../../cache/config-hash.ts";
import {
  type CrossProjectImport,
  type MissingImport,
  parseLocalImports,
} from "#veryfront/transforms/esm/import-parser.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { getApiBaseUrlEnv } from "#veryfront/config/env.ts";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { extractComponent } from "../extract-component.ts";
import {
  CIRCUIT_BREAKER_RESET_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  IN_PROGRESS_WAIT_TIMEOUT_MS,
  MAX_CONCURRENT_TRANSFORMS,
  MAX_TRANSFORM_DEPTH,
  TRANSFORM_ACQUIRE_TIMEOUT_MS,
  TRANSFORM_BATCH_SIZE,
} from "./constants.ts";
import { withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import {
  acquireTransformSlot,
  failedComponents,
  getFromRedis,
  globalCrossProjectCache,
  globalInProgress,
  globalModuleCache,
  globalTmpDirs,
  isSSRDistributedCacheEnabled,
  releaseTransformSlot,
  setInRedis,
  transformSemaphore,
} from "./cache/index.ts";
import type { ModuleCacheEntry, SSRModuleLoaderOptions } from "./types.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { lookupMdxEsmCache } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { ensureHttpBundlesExist } from "#veryfront/transforms/esm/http-cache.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";

/** Pattern to match HTTP bundle file:// paths in transformed code */
const HTTP_BUNDLE_PATTERN = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;

/** Pattern to match ALL file:// paths in transformed code (local imports + HTTP bundles) */
const ALL_FILE_PATHS_PATTERN = /file:\/\/([^"'\s]+\.(?:mjs|js))/gi;

/** Extract HTTP bundle paths from transformed code for proactive recovery */
function extractHttpBundlePaths(code: string): Array<{ path: string; hash: string }> {
  const bundles: Array<{ path: string; hash: string }> = [];
  const seen = new Set<string>();
  let match;
  while ((match = HTTP_BUNDLE_PATTERN.exec(code)) !== null) {
    const path = match[1] as string;
    const hash = match[2] as string;
    if (!seen.has(hash)) {
      seen.add(hash);
      bundles.push({ path, hash });
    }
  }
  HTTP_BUNDLE_PATTERN.lastIndex = 0;
  return bundles;
}

/**
 * Extract ALL file:// paths from cached code (local imports + HTTP bundles).
 * Used to validate that all paths in cached transforms exist locally before use.
 * This prevents "Module not found" errors when Redis returns transforms from
 * other pods with different temp directories.
 */
function extractAllFilePaths(code: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  let match;
  while ((match = ALL_FILE_PATHS_PATTERN.exec(code)) !== null) {
    const path = match[1] as string;
    if (!seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  ALL_FILE_PATHS_PATTERN.lastIndex = 0;
  return paths;
}

/**
 * Track modules whose HTTP bundles have been verified, keyed by tempPath:contentHash.
 * Bounded LRU to prevent unbounded memory growth in long-running pods.
 * Keying by contentHash ensures verification is re-done when content changes at the same path.
 */
const verifiedHttpBundlePaths = new LRUCache<string, true>({ maxEntries: 2000 });

/**
 * SSR Module Loader with Redis Support.
 *
 * Loads and transforms React components for server-side rendering.
 * Supports Redis caching to share transformed modules across pods.
 */
export class SSRModuleLoader {
  private fs = createFileSystem();
  private missingDependencies: MissingImport[] = [];
  private cachedConfigHash: string | undefined;

  constructor(private options: SSRModuleLoaderOptions) {}

  /** Lazily compute config hash once per loader instance. */
  private getConfigHash(): string {
    if (!this.cachedConfigHash) {
      this.cachedConfigHash = computeConfigHashSync({
        reactVersion: this.options.reactVersion,
        dev: this.options.dev,
      });
    }
    return this.cachedConfigHash;
  }

  /**
   * Load and transform a module for SSR.
   */
  loadModule(
    filePath: string,
    source: string,
  ): Promise<React.ComponentType<Record<string, unknown>>> {
    const fileName = filePath.split("/").pop() || filePath;

    return withSpan(
      SpanNames.SSR_LOAD_MODULE,
      async () => {
        const circuitKey = this.getCacheKey(filePath);
        this.checkCircuitBreaker(circuitKey, filePath);

        this.missingDependencies = [];

        try {
          await this.transformWithDependencies(filePath, source);

          if (this.missingDependencies.length > 0) {
            this.throwMissingDependencies(filePath);
          }

          const cacheKey = this.getCacheKey(filePath);
          const cacheEntry = globalModuleCache.get(cacheKey);
          if (!cacheEntry) {
            throw toError(
              createError({
                type: "build",
                message: `Failed to transform module: ${filePath}`,
                context: { file: filePath, phase: "transform" },
              }),
            );
          }

          let mod: Record<string, unknown>;
          try {
            mod = await withSpan(
              SpanNames.SSR_DYNAMIC_IMPORT,
              () => import(`file://${cacheEntry.tempPath}?v=${cacheEntry.contentHash}`),
              { "ssr.file": fileName },
            ) as Record<string, unknown>;
          } catch (importError) {
            // If import fails due to missing HTTP bundle, try to recover and retry once
            const errorMsg = importError instanceof Error
              ? importError.message
              : String(importError);
            const bundleMatch = errorMsg.match(/veryfront-http-bundle\/http-([a-f0-9]+)\.mjs/);
            if (bundleMatch) {
              const hash = bundleMatch[1]!;
              const cacheDir = getHttpBundleCacheDir();

              logger.error("[SSR-MODULE-LOADER] Missing HTTP bundle after ensureHttpBundlesExist", {
                file: filePath.slice(-40),
                hash,
                tempPath: cacheEntry.tempPath,
                contentHash: cacheEntry.contentHash,
                cacheDir,
                expectedPath: `${cacheDir}/http-${hash}.mjs`,
              });

              const { recoverHttpBundleByHash } = await import(
                "#veryfront/transforms/esm/http-cache.ts"
              );
              const recovered = await recoverHttpBundleByHash(hash, cacheDir);
              if (recovered) {
                logger.info("[SSR-MODULE-LOADER] HTTP bundle recovered, retrying import", {
                  hash,
                  file: filePath.slice(-40),
                });
                mod = await import(
                  `file://${cacheEntry.tempPath}?v=${cacheEntry.contentHash}&retry=1`
                ) as Record<string, unknown>;
              } else {
                logger.error("[SSR-MODULE-LOADER] HTTP bundle recovery failed", {
                  hash,
                  file: filePath.slice(-40),
                  cacheDir,
                  hint:
                    "Bundle may have expired from Redis (24h TTL) while transform was still cached",
                });
                throw importError;
              }
            } else {
              throw importError;
            }
          }

          failedComponents.delete(circuitKey);
          return extractComponent(mod, filePath);
        } catch (error) {
          const existing = failedComponents.get(circuitKey);
          failedComponents.set(circuitKey, {
            count: (existing?.count ?? 0) + 1,
            lastFailure: Date.now(),
          });
          throw error;
        }
      },
      {
        "ssr.file": fileName,
        "ssr.project_id": this.options.projectId,
        "ssr.source_length": source.length,
      },
    );
  }

  private checkCircuitBreaker(circuitKey: string, filePath: string): void {
    const failureRecord = failedComponents.get(circuitKey);
    if (!failureRecord) return;

    const timeSinceFailure = Date.now() - failureRecord.lastFailure;

    if (
      failureRecord.count >= CIRCUIT_BREAKER_THRESHOLD &&
      timeSinceFailure < CIRCUIT_BREAKER_RESET_MS
    ) {
      throw toError(
        createError({
          type: "build",
          message:
            `Component ${filePath} is temporarily blocked due to repeated failures. Will retry in ${
              Math.ceil(
                (CIRCUIT_BREAKER_RESET_MS - timeSinceFailure) / 1000,
              )
            }s.`,
          context: {
            file: filePath,
            phase: "circuit-breaker",
            failures: failureRecord.count,
          },
        }),
      );
    }

    if (timeSinceFailure >= CIRCUIT_BREAKER_RESET_MS) {
      failedComponents.delete(circuitKey);
    }
  }

  private throwMissingDependencies(filePath: string): never {
    const missingList = this.missingDependencies
      .map((m) => `  - ${m.specifier} (from ${m.fromFile.slice(-40)}): ${m.reason}`)
      .join("\n");

    logger.error("[SSR-MODULE-LOADER] Missing dependencies detected", {
      file: filePath.slice(-60),
      missing: this.missingDependencies.length,
      details: this.missingDependencies,
    });

    throw toError(
      createError({
        type: "build",
        message: `Component has missing dependencies:\n${missingList}`,
        context: {
          file: filePath,
          phase: "dependency-resolution",
          missing: this.missingDependencies,
        },
      }),
    );
  }

  private getCacheKey(filePath: string): string {
    if (!this.options.contentSourceId) {
      throw new Error(
        `Missing contentSourceId for SSR module cache (project: ${this.options.projectId}, file: ${filePath})`,
      );
    }
    // Include reactVersion and config hash to ensure different configs don't share cached modules
    const reactVersion = this.options.reactVersion ?? "default";
    const configHash = this.getConfigHash();
    return buildSSRModuleCacheKey(
      TRANSFORM_CACHE_VERSION,
      this.options.projectId,
      `${this.options.contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
    );
  }

  private isProductionContentSource(): boolean {
    const sourceId = this.options.contentSourceId;
    if (!sourceId) {
      return !this.options.dev;
    }

    if (
      sourceId.startsWith("preview-") || sourceId === "preview" || sourceId === "preview-draft"
    ) {
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

  private getRegistryBaseUrl(): string {
    const apiBaseUrl = this.options.apiBaseUrl || getApiBaseUrlEnv();
    return apiBaseUrl.replace(/\/api\/?$/, "");
  }

  /**
   * Fetch and transform a cross-project import.
   */
  private async transformCrossProjectImport(
    crossProjectImport: CrossProjectImport,
  ): Promise<string> {
    const { specifier, projectSlug, version, path } = crossProjectImport;
    // Include consuming project's context in cache key to prevent cross-project pollution.
    // Different projects may use different React versions or JSX configs, so the same
    // specifier can produce different transforms depending on the consumer.
    const reactVersion = this.options.reactVersion ?? "default";
    const cacheKey = `${specifier}:${this.options.projectId}:${reactVersion}`;

    const cachedEntry = globalCrossProjectCache.get(cacheKey);
    if (cachedEntry) return cachedEntry.tempPath;

    const registryBaseUrl = this.getRegistryBaseUrl();
    const projectRef = `${projectSlug}@${version}`;
    const registryUrl = `${registryBaseUrl}/${projectRef}/@/${path}`;

    logger.debug("[SSR-MODULE-LOADER] Fetching cross-project import", {
      specifier,
      registryUrl,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_FETCH_TIMEOUT_MS);

    try {
      const headers = new Headers({
        Accept: "text/plain, application/javascript, */*",
      });
      injectContext(headers);

      const response = await fetch(registryUrl, { signal: controller.signal, headers });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${registryUrl}: ${response.status} ${response.statusText}`,
        );
      }

      const sourceCode = await response.text();
      const contentHash = await this.hashContentAsync(sourceCode);

      const ext = path.match(/\.(tsx?|jsx?|mdx)$/)?.[0] ?? ".tsx";
      const syntheticFilePath = `cross-project/${projectRef}/@/${path}`;
      const tempPath = await this.getTempPath(syntheticFilePath, contentHash);
      await this.fs.mkdir(tempPath.substring(0, tempPath.lastIndexOf("/")), { recursive: true });

      const useSemaphore = MAX_CONCURRENT_TRANSFORMS > 0;
      const projectId = this.options.projectId;
      let projectSlotAcquired = false;

      // Per-project fairness check (fast, no waiting)
      if (!acquireTransformSlot(projectId)) {
        throw new Error(
          `Project ${projectId} at transform capacity. Consider reducing page complexity or request rate.`,
        );
      }
      projectSlotAcquired = true;

      if (useSemaphore) {
        const acquired = await transformSemaphore.tryAcquire(TRANSFORM_ACQUIRE_TIMEOUT_MS);
        if (!acquired) {
          releaseTransformSlot(projectId);
          projectSlotAcquired = false;
          throw new Error(
            `Transform capacity exceeded (${transformSemaphore.waiting} waiting). Service is overloaded.`,
          );
        }
      }

      try {
        const transformOpts: TransformOptions = {
          projectId,
          dev: this.options.dev,
          ssr: true,
          apiBaseUrl: this.options.apiBaseUrl,
          reactVersion: this.options.reactVersion,
        };

        const filePathWithExt = syntheticFilePath.endsWith(ext)
          ? syntheticFilePath
          : syntheticFilePath + ext;

        const transformed = await transformToESM(
          sourceCode,
          filePathWithExt,
          this.options.projectDir,
          this.options.adapter,
          transformOpts,
        );

        await this.fs.writeTextFile(tempPath, transformed);

        globalCrossProjectCache.set(cacheKey, { tempPath, contentHash });

        logger.debug("[SSR-MODULE-LOADER] Cross-project import transformed", {
          specifier,
          tempPath,
        });

        return tempPath;
      } finally {
        if (useSemaphore) transformSemaphore.release();
        if (projectSlotAcquired) releaseTransformSlot(projectId);
      }
    } catch (error) {
      clearTimeout(timeout);
      logger.error("[SSR-MODULE-LOADER] Failed to fetch cross-project import", {
        specifier,
        registryUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private transformWithDependencies(
    filePath: string,
    source?: string,
    depth: number = 0,
  ): Promise<void> {
    const fileName = filePath.split("/").pop() || filePath;

    return withSpan(
      SpanNames.SSR_TRANSFORM_DEPENDENCIES,
      () => this.doTransformWithDependencies(filePath, source, depth),
      {
        "ssr.file": fileName,
        "ssr.depth": depth,
      },
    );
  }

  private async doTransformWithDependencies(
    filePath: string,
    source?: string,
    depth: number = 0,
  ): Promise<void> {
    if (depth > MAX_TRANSFORM_DEPTH) {
      logger.warn("[SSR-MODULE-LOADER] Max transform depth exceeded", {
        file: filePath.slice(-40),
        depth,
        maxDepth: MAX_TRANSFORM_DEPTH,
      });
      throw toError(
        createError({
          type: "build",
          message:
            `Max transform depth exceeded (${MAX_TRANSFORM_DEPTH}, depth=${depth}) for ${filePath}. Check for circular dependencies.`,
          context: { file: filePath, phase: "transform" },
        }),
      );
    }

    const code = source ?? (await this.options.adapter.fs.readFile(filePath));
    const contentHash = await this.hashContentAsync(code);
    const contentCacheKey = this.getCacheKey(`${filePath}:${contentHash}`);
    const filePathCacheKey = this.getCacheKey(filePath);
    // Use content hash in inProgressKey to prevent race condition where
    // different content versions wait for each other's transforms
    const inProgressKey = contentCacheKey;

    const cachedEntry = globalModuleCache.get(contentCacheKey);
    if (cachedEntry) {
      // Verify HTTP bundles exist for in-memory cached transforms (once per path+content)
      const verifyKey = `${cachedEntry.tempPath}:${cachedEntry.contentHash}`;
      if (!verifiedHttpBundlePaths.get(verifyKey)) {
        try {
          const cachedCode = await this.fs.readTextFile(cachedEntry.tempPath);
          const bundlePaths = extractHttpBundlePaths(cachedCode);
          if (bundlePaths.length > 0) {
            const cacheDir = getHttpBundleCacheDir();
            const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
            if (failed.length > 0) {
              logger.warn("[SSR-MODULE-LOADER] Unrecoverable HTTP bundles, re-transforming", {
                file: filePath.slice(-40),
                failed,
                totalBundles: bundlePaths.length,
                cacheDir,
                source: "memory-cache",
              });
              globalModuleCache.delete(contentCacheKey);
              globalModuleCache.delete(filePathCacheKey);
              // Fall through to Redis or fresh transform
            } else {
              verifiedHttpBundlePaths.set(verifyKey, true);
            }
          } else {
            verifiedHttpBundlePaths.set(verifyKey, true);
          }
        } catch {
          // File doesn't exist or unreadable, invalidate cache
          globalModuleCache.delete(contentCacheKey);
          globalModuleCache.delete(filePathCacheKey);
        }
      }

      // Re-check after potential invalidation
      if (globalModuleCache.has(contentCacheKey)) {
        globalModuleCache.set(filePathCacheKey, cachedEntry);
        await this.ensureDependenciesExist(code, filePath, depth);
        return;
      }
    }

    if (isSSRDistributedCacheEnabled()) {
      const redisCode = await getFromRedis(contentCacheKey);
      if (redisCode) {
        // Proactively ensure HTTP bundles exist before using cached transform.
        // The cached code may reference file:// paths to HTTP bundles that were
        // created on a different pod and may not exist locally.
        let allPathsOk = true;
        const bundlePaths = extractHttpBundlePaths(redisCode);
        if (bundlePaths.length > 0) {
          const cacheDir = getHttpBundleCacheDir();
          const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
          if (failed.length > 0) {
            logger.warn("[SSR-MODULE-LOADER] Unrecoverable HTTP bundles, re-transforming", {
              file: filePath.slice(-40),
              failed,
              totalBundles: bundlePaths.length,
              cacheDir,
              source: "redis-cache",
            });
            allPathsOk = false;
          }
        }

        // Validate ALL file:// paths in cached code (including local imports).
        // Redis may return cached transforms from other pods with different temp directories.
        // If any local import paths are missing, we must re-transform.
        if (allPathsOk) {
          const allPaths = extractAllFilePaths(redisCode);
          for (const path of allPaths) {
            try {
              const stat = await this.fs.stat(path);
              if (!stat.isFile) {
                allPathsOk = false;
                break;
              }
            } catch {
              // Path doesn't exist locally
              logger.debug(
                "[SSR-MODULE-LOADER] Redis cache has invalid local path, re-transforming",
                {
                  file: filePath.slice(-40),
                  missingPath: path.slice(-60),
                },
              );
              allPathsOk = false;
              break;
            }
          }
        }

        if (allPathsOk) {
          // CRITICAL: Use transformedHash (hash of the transformed code) for temp path,
          // NOT contentHash (hash of source). Other modules importing this file use
          // transformedHash in their import paths (set during fresh transform at line 703).
          // Using contentHash here would create a path mismatch and "Module not found" errors.
          const transformedHash = await this.hashContentAsync(redisCode);
          const tempPath = await this.getTempPath(filePath, transformedHash);
          await this.fs.mkdir(tempPath.substring(0, tempPath.lastIndexOf("/")), {
            recursive: true,
          });
          await this.fs.writeTextFile(tempPath, redisCode);
          verifiedHttpBundlePaths.set(`${tempPath}:${transformedHash}`, true);

          const entry: ModuleCacheEntry = { tempPath, contentHash: transformedHash };
          globalModuleCache.set(contentCacheKey, entry);
          globalModuleCache.set(filePathCacheKey, entry);

          logger.debug("[SSR-MODULE-LOADER] Redis cache hit", { file: filePath.slice(-40) });

          await this.ensureDependenciesExist(code, filePath, depth);
          return;
        }
        // Fall through to re-transform, which will create HTTP bundles locally
      }
    }

    // Check MDX-ESM cache to share modules with MDX loader and avoid duplicate React contexts
    if (this.options.projectId && this.options.contentSourceId) {
      const baseCacheDir = getMdxEsmCacheDir();
      // Use projectId consistently for stable cache keys (matches MDX loader)
      const projectKey = encodeURIComponent(this.options.projectId);
      const sourceKey = this.options.contentSourceId;
      const mdxCacheDir = join(baseCacheDir, projectKey, sourceKey);

      const mdxCachedPath = await lookupMdxEsmCache(
        filePath,
        mdxCacheDir,
        this.options.projectDir,
        contentHash,
      );
      if (mdxCachedPath) {
        const entry: ModuleCacheEntry = { tempPath: mdxCachedPath, contentHash };
        globalModuleCache.set(contentCacheKey, entry);
        globalModuleCache.set(filePathCacheKey, entry);

        logger.debug("[SSR-MODULE-LOADER] Reusing MDX-ESM cache", {
          file: filePath.slice(-40),
          cachedPath: mdxCachedPath.slice(-60),
        });

        await this.ensureDependenciesExist(code, filePath, depth);
        return;
      }
    }

    const existingTransform = globalInProgress.get(inProgressKey);
    if (existingTransform) {
      try {
        await withSpan(
          SpanNames.SSR_WAIT_IN_PROGRESS,
          () =>
            withTimeoutThrow(
              existingTransform,
              IN_PROGRESS_WAIT_TIMEOUT_MS,
              `Waiting for in-progress transform of ${filePath}`,
            ),
          { "ssr.file": filePath.split("/").pop() || filePath },
        );
        return;
      } catch (error) {
        globalInProgress.delete(inProgressKey);
        logger.warn("[SSR-MODULE-LOADER] In-progress transform timed out, retrying", {
          file: filePath.slice(-40),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let resolveTransform!: () => void;
    let rejectTransform!: (err: Error) => void;
    const transformPromise = new Promise<void>((resolve, reject) => {
      resolveTransform = resolve;
      rejectTransform = reject;
    });
    globalInProgress.set(inProgressKey, transformPromise);

    try {
      const parseResult = await parseLocalImports(
        code,
        filePath,
        this.options.projectDir,
        this.options.adapter,
      );

      if (parseResult.missing.length > 0) {
        this.missingDependencies.push(...parseResult.missing);
      }

      const crossProjectPaths = new Map<string, string>();
      const localFs = createFileSystem();

      const localImportPaths = await this.processLocalImports(
        parseResult.imports,
        filePath,
        depth,
        localFs,
      );

      for (let i = 0; i < parseResult.crossProjectImports.length; i += TRANSFORM_BATCH_SIZE) {
        const batch = parseResult.crossProjectImports.slice(i, i + TRANSFORM_BATCH_SIZE);
        await Promise.all(
          batch.map(async (crossImport) => {
            try {
              const tempPath = await this.transformCrossProjectImport(crossImport);
              crossProjectPaths.set(crossImport.specifier, tempPath);
            } catch (error) {
              this.missingDependencies.push({
                specifier: crossImport.specifier,
                fromFile: filePath,
                reason: `Failed to fetch cross-project import: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              });
            }
          }),
        );
      }

      const useSemaphore = MAX_CONCURRENT_TRANSFORMS > 0;
      const projectId = this.options.projectId;
      let projectSlotAcquired = false;

      // Per-project fairness check (fast, no waiting)
      if (!acquireTransformSlot(projectId)) {
        throw toError(
          createError({
            type: "build",
            message:
              `Project ${projectId} at transform capacity. Consider reducing page complexity or request rate.`,
            context: { file: filePath, phase: "transform" },
          }),
        );
      }
      projectSlotAcquired = true;

      if (useSemaphore) {
        const acquired = await transformSemaphore.tryAcquire(TRANSFORM_ACQUIRE_TIMEOUT_MS);
        if (!acquired) {
          releaseTransformSlot(projectId);
          projectSlotAcquired = false;
          throw toError(
            createError({
              type: "build",
              message:
                `Transform capacity exceeded (${transformSemaphore.waiting} waiting). Service is overloaded.`,
              context: { file: filePath, phase: "transform" },
            }),
          );
        }
      }

      try {
        const transformOpts: TransformOptions = {
          projectId,
          dev: this.options.dev,
          ssr: true,
          apiBaseUrl: this.options.apiBaseUrl,
          reactVersion: this.options.reactVersion,
        };

        let transformed = await withSpan(
          SpanNames.SSR_TRANSFORM_SINGLE,
          () =>
            transformToESM(
              code,
              filePath,
              this.options.projectDir,
              this.options.adapter,
              transformOpts,
            ),
          { "ssr.file": filePath.split("/").pop() || filePath },
        );

        for (const [specifier, tempPath] of crossProjectPaths.entries()) {
          transformed = this.rewriteCrossProjectImport(transformed, specifier, tempPath);
        }

        // Rewrite local imports to use hashed temp paths
        // This ensures that each content version uses its own cached module
        transformed = this.rewriteLocalImports(transformed, localImportPaths, filePath);

        // Ensure HTTP bundles exist for this transform (handles nested bundle deps)
        const bundlePaths = extractHttpBundlePaths(transformed);
        if (bundlePaths.length > 0) {
          const cacheDir = getHttpBundleCacheDir();
          const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
          if (failed.length > 0) {
            logger.warn("[SSR-MODULE-LOADER] Unrecoverable HTTP bundles", {
              file: filePath.slice(-40),
              failed,
              totalBundles: bundlePaths.length,
              cacheDir,
              source: "fresh-transform",
            });
          }
        }

        // Hash the TRANSFORMED content (after import rewrites) for cache busting
        // This ensures Deno's module cache is invalidated when dependencies change
        const transformedHash = await this.hashContentAsync(transformed);

        const tempPath = await this.getTempPath(filePath, transformedHash);
        await this.fs.mkdir(tempPath.substring(0, tempPath.lastIndexOf("/")), { recursive: true });
        await this.fs.writeTextFile(tempPath, transformed);

        if (isSSRDistributedCacheEnabled()) {
          setInRedis(contentCacheKey, transformed, {
            isProduction: this.isProductionContentSource(),
          }).catch((error) => {
            logger.debug("[SSR-MODULE-LOADER] Distributed cache set failed", {
              key: contentCacheKey,
              error,
            });
          });
        }

        // Use transformedHash for cache busting in dynamic imports
        const entry: ModuleCacheEntry = { tempPath, contentHash: transformedHash };
        globalModuleCache.set(contentCacheKey, entry);
        globalModuleCache.set(filePathCacheKey, entry);
      } finally {
        if (useSemaphore) transformSemaphore.release();
        if (projectSlotAcquired) releaseTransformSlot(projectId);
      }

      resolveTransform();
    } catch (error) {
      rejectTransform(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      globalInProgress.delete(inProgressKey);
    }
  }

  /**
   * Process local imports and return a map of specifier -> hashed temp path
   * This allows the parent file to have its imports rewritten to the correct hashed paths.
   */
  private async processLocalImports(
    imports: Array<{ absolutePath: string; specifier: string }>,
    fromFilePath: string,
    depth: number,
    localFs: ReturnType<typeof createFileSystem>,
  ): Promise<Map<string, string>> {
    const importPathMap = new Map<string, string>();

    for (let i = 0; i < imports.length; i += TRANSFORM_BATCH_SIZE) {
      const batch = imports.slice(i, i + TRANSFORM_BATCH_SIZE);
      await Promise.all(
        batch.map(async (imp) => {
          try {
            const useLocalFs = imp.absolutePath.startsWith("/");
            const depSource = useLocalFs
              ? await localFs.readTextFile(imp.absolutePath)
              : await this.options.adapter.fs.readFile(imp.absolutePath);

            await this.transformWithDependencies(imp.absolutePath, depSource, depth + 1);

            // After transforming, get the cache entry to find the hashed temp path
            const depCacheKey = this.getCacheKey(imp.absolutePath);
            const depEntry = globalModuleCache.get(depCacheKey);
            if (depEntry) {
              importPathMap.set(imp.specifier, depEntry.tempPath);
              importPathMap.set(imp.absolutePath, depEntry.tempPath);
            }
          } catch (error) {
            this.missingDependencies.push({
              specifier: imp.specifier,
              fromFile: fromFilePath,
              reason: `Failed to read file: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }),
      );
    }

    return importPathMap;
  }

  private rewriteCrossProjectImport(
    transformed: string,
    specifier: string,
    tempPath: string,
  ): string {
    const jsSpecifier = specifier.replace(/\.(tsx?|jsx|mdx)$/, ".js");
    const escapedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedJsSpecifier = jsSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`from\\s*["'](${escapedSpecifier}|${escapedJsSpecifier})["']`, "g");
    return transformed.replace(pattern, `from "file://${tempPath}"`);
  }

  /**
   * Rewrite local imports to use hashed temp paths.
   * This ensures each content version uses its own cached module file.
   */
  private rewriteLocalImports(
    transformed: string,
    localImportPaths: Map<string, string>,
    fromFilePath: string,
  ): string {
    if (localImportPaths.size === 0) return transformed;

    const projectDir = this.options.projectDir.replace(/\/$/, "");
    const fromFileDir = fromFilePath.substring(0, fromFilePath.lastIndexOf("/"));
    const fromRelativeDir = fromFileDir.startsWith(projectDir)
      ? fromFileDir.substring(projectDir.length + 1)
      : fromFileDir;

    let result = transformed;

    for (const [specifierOrPath, tempPath] of localImportPaths.entries()) {
      const patterns = this.buildImportPatterns(specifierOrPath, fromRelativeDir, projectDir);

      for (const pattern of patterns) {
        const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`from\\s*["'](${escapedPattern})["']`, "g");
        result = result.replace(regex, `from "file://${tempPath}"`);
      }
    }

    return result;
  }

  /**
   * Build import patterns for a given specifier to match in transformed code.
   */
  private buildImportPatterns(
    specifierOrPath: string,
    fromRelativeDir: string,
    projectDir: string,
  ): string[] {
    // Handle @/ alias imports (e.g., @/components/Welcome)
    if (specifierOrPath.startsWith("@/")) {
      return this.buildAliasImportPatterns(specifierOrPath, fromRelativeDir);
    }

    // Handle absolute paths
    if (specifierOrPath.startsWith("/") || specifierOrPath.startsWith(projectDir)) {
      return this.buildAbsoluteImportPatterns(specifierOrPath, fromRelativeDir, projectDir);
    }

    // Handle relative imports (./foo, ../foo)
    if (specifierOrPath.startsWith("./") || specifierOrPath.startsWith("../")) {
      return this.buildRelativeImportPatterns(specifierOrPath);
    }

    return [];
  }

  private buildAliasImportPatterns(specifier: string, fromRelativeDir: string): string[] {
    const aliasPath = specifier.substring(2); // Remove @/
    const depth = fromRelativeDir.split("/").filter(Boolean).length;
    const relativePrefix = depth === 0 ? "./" : "../".repeat(depth);

    const patterns = [`${relativePrefix}${aliasPath}.js`];

    // Handle paths that already have an extension
    if (/\.(tsx?|jsx|mdx)$/.test(aliasPath)) {
      patterns.push(`${relativePrefix}${this.toJsExtension(aliasPath)}`);
    }

    return patterns;
  }

  private buildAbsoluteImportPatterns(
    absolutePath: string,
    fromRelativeDir: string,
    projectDir: string,
  ): string[] {
    const depRelativePath = absolutePath.startsWith(projectDir)
      ? absolutePath.substring(projectDir.length + 1)
      : absolutePath.substring(1);

    const lastSlash = depRelativePath.lastIndexOf("/");
    const depDir = depRelativePath.substring(0, lastSlash);
    const depFile = depRelativePath.substring(lastSlash + 1);

    const relativePath = this.computeRelativePath(fromRelativeDir, depDir, depFile);
    return [this.toJsExtension(relativePath)];
  }

  private buildRelativeImportPatterns(specifier: string): string[] {
    const jsPath = this.toJsExtension(specifier);
    const patterns = [jsPath];

    if (!jsPath.endsWith(".js")) {
      patterns.push(`${jsPath}.js`);
    }

    return patterns;
  }

  /**
   * Compute relative path from source directory to target file.
   */
  private computeRelativePath(fromDir: string, toDir: string, fileName: string): string {
    const fromParts = fromDir.split("/").filter(Boolean);
    const toParts = toDir.split("/").filter(Boolean);

    let commonPrefixLen = 0;
    while (
      commonPrefixLen < fromParts.length &&
      commonPrefixLen < toParts.length &&
      fromParts[commonPrefixLen] === toParts[commonPrefixLen]
    ) {
      commonPrefixLen++;
    }

    const upCount = fromParts.length - commonPrefixLen;
    const downParts = toParts.slice(commonPrefixLen);

    if (upCount === 0 && downParts.length === 0) {
      return `./${fileName}`;
    }
    if (upCount === 0) {
      return `./${downParts.join("/")}/${fileName}`;
    }

    const upPath = "../".repeat(upCount);
    const downPath = downParts.length > 0 ? `${downParts.join("/")}/` : "";
    return `${upPath}${downPath}${fileName}`;
  }

  /**
   * Convert TypeScript/JSX extension to .js
   */
  private toJsExtension(path: string): string {
    return path.replace(/\.(tsx?|jsx|mdx)$/, ".js");
  }

  private async ensureDependenciesExist(
    code: string,
    filePath: string,
    depth: number = 0,
  ): Promise<void> {
    if (depth > MAX_TRANSFORM_DEPTH) return;

    const parseResult = await parseLocalImports(
      code,
      filePath,
      this.options.projectDir,
      this.options.adapter,
    );

    if (parseResult.missing.length > 0) {
      this.missingDependencies.push(...parseResult.missing);
    }

    const localFs = createFileSystem();
    await this.processLocalImports(parseResult.imports, filePath, depth, localFs);

    for (let i = 0; i < parseResult.crossProjectImports.length; i += TRANSFORM_BATCH_SIZE) {
      const batch = parseResult.crossProjectImports.slice(i, i + TRANSFORM_BATCH_SIZE);
      await Promise.all(
        batch.map(async (crossImport) => {
          try {
            await this.transformCrossProjectImport(crossImport);
          } catch (error) {
            this.missingDependencies.push({
              specifier: crossImport.specifier,
              fromFile: filePath,
              reason: `Failed to fetch cross-project import: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }),
      );
    }
  }

  /**
   * Async hash for large content using Web Crypto API.
   * Falls back to sync hash for small files.
   */
  private async hashContentAsync(content: string): Promise<string> {
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

  private async getTempPath(filePath: string, contentHash?: string): Promise<string> {
    const tmpDir = await this.ensureTmpDir();

    const projectDir = this.options.projectDir.replace(/\/$/, "");
    const relativePath = filePath.startsWith(projectDir)
      ? filePath.substring(projectDir.length)
      : filePath;

    // Include content hash in filename to ensure each content version gets a unique file
    // This prevents Deno's module cache from returning stale modules
    const hashSuffix = contentHash ? `.${contentHash.slice(0, 8)}` : "";
    const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, `${hashSuffix}.js`);
    return join(tmpDir, jsPath);
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

    // Use the same cache directory as MDX-ESM loader to share module instances.
    // This prevents issues like React context being created twice in separate files.
    const baseCacheDir = getMdxEsmCacheDir();
    // Use projectId consistently for stable cache keys (matches MDX loader)
    const projectKey = encodeURIComponent(projectId);
    const sourceKey = contentSourceId;
    const cacheKey = `${baseCacheDir}|${projectKey}|${sourceKey}`;

    const existingDir = globalTmpDirs.get(cacheKey);
    if (existingDir) return existingDir;

    const tmpDir = join(baseCacheDir, projectKey, sourceKey);

    await this.fs.mkdir(tmpDir, { recursive: true });
    globalTmpDirs.set(cacheKey, tmpDir);
    return tmpDir;
  }
}
