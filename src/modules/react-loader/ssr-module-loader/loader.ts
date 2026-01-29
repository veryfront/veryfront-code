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
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";
import {
  extractAllFilePaths,
  extractHttpBundlePaths,
  verifiedHttpBundlePaths,
} from "./http-bundle-helpers.ts";
import { rewriteCrossProjectImport, rewriteLocalImports } from "./import-rewriter.ts";

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
                // Recovery failed — invalidate cache so the next request triggers
                // a fresh transform instead of hitting the same broken entry.
                const cacheKey = this.getCacheKey(filePath);
                globalModuleCache.delete(cacheKey);
                logger.error("[SSR-MODULE-LOADER] HTTP bundle recovery failed, cache invalidated", {
                  hash,
                  file: filePath.slice(-40),
                  cacheDir,
                  hint:
                    "Bundle may have expired from Redis (24h TTL) while transform was still cached",
                });
                throw importError;
              }
            } else if (
              errorMsg.includes("Cannot find module") ||
              errorMsg.includes("Module not found")
            ) {
              // Missing non-HTTP-bundle dependency — cache entry is corrupted.
              // Invalidate so the next request triggers a fresh transform instead
              // of hitting the same broken cache entry repeatedly.
              const cacheKey = this.getCacheKey(filePath);
              logger.error(
                "[SSR-MODULE-LOADER] Cached module has missing dependency, invalidating cache",
                {
                  file: filePath.slice(-40),
                  tempPath: cacheEntry.tempPath,
                  error: errorMsg.slice(0, 200),
                },
              );
              globalModuleCache.delete(cacheKey);
              throw importError;
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

      const mdxCacheResult = await lookupMdxEsmCache(
        filePath,
        mdxCacheDir,
        this.options.projectDir,
        contentHash,
      );
      if (mdxCacheResult.status === "hit") {
        const entry: ModuleCacheEntry = { tempPath: mdxCacheResult.path, contentHash };
        globalModuleCache.set(contentCacheKey, entry);
        globalModuleCache.set(filePathCacheKey, entry);

        logger.debug("[SSR-MODULE-LOADER] Reusing MDX-ESM cache", {
          file: filePath.slice(-40),
          cachedPath: mdxCacheResult.path.slice(-60),
        });

        await this.ensureDependenciesExist(code, filePath, depth);
        return;
      } else if (mdxCacheResult.status === "corrupted") {
        logger.warn("[SSR-MODULE-LOADER] MDX-ESM cache corrupted, re-transforming", {
          file: filePath.slice(-40),
          reason: mdxCacheResult.reason,
        });
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
      let parseResult = await parseLocalImports(
        code,
        filePath,
        this.options.projectDir,
        this.options.adapter,
      );

      if (parseResult.missing.length > 0) {
        this.missingDependencies.push(...parseResult.missing);
      }

      // P2: Pre-flight validation — check local import paths exist before
      // starting expensive recursive transforms. Only validates local filesystem
      // paths (startsWith "/"); remote adapter paths are validated by the adapter.
      // Files that disappeared between parseLocalImports and now are demoted to
      // missing deps (not transform rejections) to avoid dangling promises.
      if (parseResult.imports.length > 0) {
        const preflightFs = createFileSystem();
        const preflightMissing: MissingImport[] = [];
        const validImports = [];
        for (const imp of parseResult.imports) {
          if (!imp.absolutePath.startsWith("/")) {
            validImports.push(imp);
            continue;
          }
          try {
            const stat = await preflightFs.stat(imp.absolutePath);
            if (stat?.isFile) {
              validImports.push(imp);
            } else {
              preflightMissing.push({
                specifier: imp.specifier,
                fromFile: filePath,
                reason: `Pre-flight: not a file on disk: ${imp.absolutePath}`,
              });
            }
          } catch {
            preflightMissing.push({
              specifier: imp.specifier,
              fromFile: filePath,
              reason: `Pre-flight: file not accessible: ${imp.absolutePath}`,
            });
          }
        }
        if (preflightMissing.length > 0) {
          logger.warn("[SSR-MODULE-LOADER] Pre-flight: some dependencies missing, skipping them", {
            file: filePath.slice(-40),
            missing: preflightMissing.map((m) => m.specifier),
            depth,
          });
          this.missingDependencies.push(...preflightMissing);
          // Continue with only valid imports — the transform can still proceed
          // and the missing deps will be reported via throwMissingDependencies
          parseResult = { ...parseResult, imports: validImports };
        }
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
          transformed = rewriteCrossProjectImport(transformed, specifier, tempPath);
        }

        // Rewrite local imports to use hashed temp paths
        // This ensures that each content version uses its own cached module
        transformed = rewriteLocalImports(
          transformed,
          localImportPaths,
          filePath,
          this.options.projectDir,
        );

        // Ensure HTTP bundles exist for this transform (handles nested bundle deps)
        const bundlePaths = extractHttpBundlePaths(transformed);
        if (bundlePaths.length > 0) {
          const cacheDir = getHttpBundleCacheDir();
          const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
          if (failed.length > 0) {
            logger.error("[SSR-MODULE-LOADER] Unrecoverable HTTP bundles", {
              file: filePath.slice(-40),
              failed,
              totalBundles: bundlePaths.length,
              cacheDir,
              source: "fresh-transform",
            });
            throw toError(
              createError({
                type: "build",
                message: `Missing HTTP bundles after transform (${failed.length}).`,
                context: {
                  file: filePath,
                  phase: "http-bundle-validation",
                  failed,
                  cacheDir,
                },
              }),
            );
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
