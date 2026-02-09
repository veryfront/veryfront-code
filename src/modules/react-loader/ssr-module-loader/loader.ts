/**
 * SSR Module Loader Class
 *
 * Loads and transforms React components for server-side rendering.
 *
 * @module module-system/react-loader/ssr-module-loader/loader
 */

import { join } from "#veryfront/compat/path/index.ts";
import type * as React from "react";
import { transformToESM } from "#veryfront/transforms/esm/index.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import {
  type CrossProjectImport,
  parseLocalImports,
} from "#veryfront/transforms/esm/import-parser.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { verifyCacheFileExists, writeCacheFile } from "#veryfront/utils/cache-file-ops.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { extractComponent } from "../extract-component.ts";
import {
  getMaxConcurrentTransforms,
  IN_PROGRESS_WAIT_TIMEOUT_MS,
  MAX_TRANSFORM_DEPTH,
  TRANSFORM_ACQUIRE_TIMEOUT_MS,
  TRANSFORM_BATCH_SIZE,
} from "./constants.ts";
import { withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import {
  getFromRedis,
  getTransformSemaphore,
  globalInProgress,
  globalModuleCache,
  isSSRDistributedCacheEnabled,
  releaseTransformSlot,
  setInRedis,
  tryAcquireTransformSlot,
} from "./cache/index.ts";
import type { ModuleCacheEntry, SSRModuleLoaderOptions } from "./types.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { lookupMdxEsmCache } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { ensureHttpBundlesExist } from "#veryfront/transforms/esm/http-cache.ts";
import { extractHttpBundlePaths, verifiedHttpBundlePaths } from "./http-bundle-helpers.ts";
import { rewriteCrossProjectImport, rewriteLocalImports } from "./import-rewriter.ts";
import { transformCrossProjectImportFlow } from "./cross-project-import-loader.ts";
import { SSRCacheManager } from "./ssr-cache-manager.ts";
import { SSRCircuitBreaker } from "./ssr-circuit-breaker.ts";
import { SSRDependencyValidator } from "./ssr-dependency-validator.ts";
import { preflightLocalImports } from "./preflight-imports.ts";
import { resolveVfModuleImports } from "./vf-module-resolver.ts";

const MISSING_HTTP_BUNDLE_PATTERN = /veryfront-http-bundle\/http-([a-f0-9]+)\.mjs/;

type TransformCapacityErrorMode = "plain" | "build";

type ImportErrorClassification =
  | { type: "http-bundle-missing"; hash: string; message: string }
  | { type: "module-not-found"; message: string }
  | { type: "unknown"; message: string };

/**
 * SSR Module Loader with Redis Support.
 *
 * Loads and transforms React components for server-side rendering.
 * Supports Redis caching to share transformed modules across pods.
 */
export class SSRModuleLoader {
  private cache: SSRCacheManager;
  private circuitBreaker = new SSRCircuitBreaker();
  private depValidator: SSRDependencyValidator;

  constructor(private options: SSRModuleLoaderOptions) {
    this.cache = new SSRCacheManager(options);
    this.depValidator = new SSRDependencyValidator(
      (filePath) => this.cache.getCacheKey(filePath),
      (filePath, source, depth) => this.transformWithDependencies(filePath, source, depth),
      (crossImport) => this.transformCrossProjectImport(crossImport),
      options.adapter,
      options.projectDir,
    );
  }

  private classifyImportError(importError: unknown): ImportErrorClassification {
    const message = importError instanceof Error ? importError.message : String(importError);
    const bundleMatch = message.match(MISSING_HTTP_BUNDLE_PATTERN);
    if (bundleMatch?.[1]) {
      return { type: "http-bundle-missing", hash: bundleMatch[1], message };
    }
    if (message.includes("Cannot find module") || message.includes("Module not found")) {
      return { type: "module-not-found", message };
    }
    return { type: "unknown", message };
  }

  private createTransformCapacityError(
    mode: TransformCapacityErrorMode,
    message: string,
    filePath: string,
  ): Error {
    if (mode === "plain") return new Error(message);
    return toError(
      createError({
        type: "build",
        message,
        context: { file: filePath, phase: "transform" },
      }),
    );
  }

  private async withTransformCapacity<T>(
    filePath: string,
    mode: TransformCapacityErrorMode,
    operation: () => Promise<T>,
  ): Promise<T> {
    const useSemaphore = getMaxConcurrentTransforms() > 0;
    const projectId = this.options.projectId;
    const semaphore = useSemaphore ? getTransformSemaphore() : undefined;
    let semaphoreAcquired = false;

    if (!await tryAcquireTransformSlot(projectId, TRANSFORM_ACQUIRE_TIMEOUT_MS)) {
      throw this.createTransformCapacityError(
        mode,
        `Project ${projectId} at transform capacity. Consider reducing page complexity or request rate.`,
        filePath,
      );
    }

    try {
      if (semaphore) {
        semaphoreAcquired = await semaphore.tryAcquire(TRANSFORM_ACQUIRE_TIMEOUT_MS);
        if (!semaphoreAcquired) {
          throw this.createTransformCapacityError(
            mode,
            `Transform capacity exceeded (${semaphore.waiting} waiting). Service is overloaded.`,
            filePath,
          );
        }
      }

      return await operation();
    } finally {
      if (semaphore && semaphoreAcquired) {
        semaphore.release();
      }
      releaseTransformSlot(projectId);
    }
  }

  private async importModuleFromCacheEntry(
    filePath: string,
    fileName: string,
    cacheEntry: ModuleCacheEntry,
  ): Promise<Record<string, unknown>> {
    // Verify the cache file exists before attempting dynamic import
    const fileExists = await verifyCacheFileExists(
      this.cache.getFs(),
      cacheEntry.tempPath,
      "SSR-MODULE-LOADER",
    );
    if (!fileExists) {
      logger.error("[SSR-MODULE-LOADER] Cache file missing before import, invalidating", {
        file: filePath.slice(-40),
        tempPath: cacheEntry.tempPath,
        contentHash: cacheEntry.contentHash,
      });
      this.cache.invalidateFilePathCacheEntry(filePath, cacheEntry);
      throw toError(
        createError({
          type: "build",
          message: `Cache file missing: ${cacheEntry.tempPath}`,
          context: { file: filePath, phase: "transform" },
        }),
      );
    }

    try {
      return (await withSpan(
        SpanNames.SSR_DYNAMIC_IMPORT,
        () => import(`file://${cacheEntry.tempPath}?v=${cacheEntry.contentHash}`),
        { "ssr.file": fileName },
      )) as Record<string, unknown>;
    } catch (importError) {
      const classifiedError = this.classifyImportError(importError);

      if (classifiedError.type === "http-bundle-missing") {
        const hash = classifiedError.hash;
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
          return (await import(
            `file://${cacheEntry.tempPath}?v=${cacheEntry.contentHash}&retry=1`
          )) as Record<string, unknown>;
        }

        this.cache.invalidateFilePathCacheEntry(filePath, cacheEntry);

        logger.error("[SSR-MODULE-LOADER] HTTP bundle recovery failed, cache invalidated", {
          hash,
          file: filePath.slice(-40),
          cacheDir,
          hint: "Bundle may have expired from Redis (24h TTL) while transform was still cached",
        });
        throw importError;
      }

      if (classifiedError.type === "module-not-found") {
        logger.error(
          "[SSR-MODULE-LOADER] Cached module has missing dependency, invalidating cache",
          {
            file: filePath.slice(-40),
            tempPath: cacheEntry.tempPath,
            error: classifiedError.message.slice(0, 200),
          },
        );
        this.cache.invalidateFilePathCacheEntry(filePath, cacheEntry);
      }

      throw importError;
    }
  }

  loadModule(
    filePath: string,
    source: string,
  ): Promise<React.ComponentType<Record<string, unknown>>> {
    const fileName = filePath.split("/").pop() || filePath;

    return withSpan(
      SpanNames.SSR_LOAD_MODULE,
      async () => {
        const circuitKey = this.cache.getCacheKey(filePath);
        this.circuitBreaker.check(circuitKey, filePath);

        this.depValidator.reset();

        try {
          await this.transformWithDependencies(filePath, source);

          if (this.depValidator.missingDependencies.length > 0) {
            this.depValidator.throwMissingDependencies(filePath);
          }

          const cacheKey = this.cache.getCacheKey(filePath);
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

          const mod = await this.importModuleFromCacheEntry(filePath, fileName, cacheEntry);

          this.circuitBreaker.recordSuccess(circuitKey);
          return extractComponent(mod, filePath);
        } catch (error) {
          this.circuitBreaker.recordFailure(circuitKey);
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

  private async transformCrossProjectImport(
    crossProjectImport: CrossProjectImport,
  ): Promise<string> {
    return transformCrossProjectImportFlow({
      crossProjectImport,
      options: this.options,
      cache: this.cache,
      withTransformCapacity: (syntheticFilePath, operation) =>
        this.withTransformCapacity(syntheticFilePath, "plain", operation),
    });
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
    const contentHash = await this.cache.hashContentAsync(code);
    const contentCacheKey = this.cache.getCacheKey(`${filePath}:${contentHash}`);
    const filePathCacheKey = this.cache.getCacheKey(filePath);
    const inProgressKey = contentCacheKey;

    const cachedEntry = globalModuleCache.get(contentCacheKey);
    if (cachedEntry) {
      if (
        await this.cache.validateMemoryCacheEntry(
          cachedEntry,
          contentCacheKey,
          filePathCacheKey,
          filePath,
        )
      ) {
        globalModuleCache.set(filePathCacheKey, cachedEntry);
        await this.depValidator.ensureDependenciesExist(code, filePath, depth);
        return;
      }
    }

    if (isSSRDistributedCacheEnabled()) {
      const redisCode = await getFromRedis(contentCacheKey);
      if (redisCode) {
        const isValidRedisCode = await this.cache.validateCachedCode(
          redisCode,
          filePath,
          "redis-cache",
          {
            checkLocalPaths: true,
            checkInvalidEsmShPath: true,
          },
        );
        if (isValidRedisCode) {
          const transformedHash = await this.cache.hashContentAsync(redisCode);
          const tempPath = await this.cache.getTempPath(filePath, transformedHash);
          const written = await writeCacheFile(
            this.cache.getFs(),
            tempPath,
            redisCode,
            "SSR-MODULE-LOADER",
          );
          if (written) {
            verifiedHttpBundlePaths.set(`${tempPath}:${transformedHash}`, true);

            const entry: ModuleCacheEntry = { tempPath, contentHash: transformedHash };
            globalModuleCache.set(contentCacheKey, entry);
            globalModuleCache.set(filePathCacheKey, entry);

            logger.debug("[SSR-MODULE-LOADER] Redis cache hit", { file: filePath.slice(-40) });

            await this.depValidator.ensureDependenciesExist(code, filePath, depth);
            return;
          }
          // writeCacheFile returned false — fall through to fresh transform
        }
      }
    }

    if (this.options.projectId && this.options.contentSourceId) {
      const baseCacheDir = getMdxEsmCacheDir();
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

        await this.depValidator.ensureDependenciesExist(code, filePath, depth);
        return;
      }

      if (mdxCacheResult.status === "corrupted") {
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
    // Attach no-op catch to prevent unhandled rejection when waiters timeout
    // and stop listening. The actual error is thrown to the caller directly.
    transformPromise.catch(() => {});
    globalInProgress.set(inProgressKey, transformPromise);

    try {
      let parseResult = await parseLocalImports(
        code,
        filePath,
        this.options.projectDir,
        this.options.adapter,
      );

      if (parseResult.missing.length > 0) {
        this.depValidator.missingDependencies.push(...parseResult.missing);
      }

      if (parseResult.imports.length > 0) {
        const preflightFs = createFileSystem();
        const { validImports, missingImports: preflightMissing } = await preflightLocalImports(
          parseResult.imports,
          filePath,
          preflightFs,
        );

        if (preflightMissing.length > 0) {
          logger.warn("[SSR-MODULE-LOADER] Pre-flight: some dependencies missing, skipping them", {
            file: filePath.slice(-40),
            missing: preflightMissing.map((m) => m.specifier),
            depth,
          });
          this.depValidator.missingDependencies.push(...preflightMissing);
          parseResult = { ...parseResult, imports: validImports };
        }
      }

      // Process recursive imports FIRST, without holding a project slot.
      // Each recursive child acquires its own slot for its own transform only.
      // This prevents hierarchical deadlock where parent holds a slot while
      // children also need slots (10 batch x 2 depth = 21 slots, but limit is 17).
      const crossProjectPaths = new Map<string, string>();
      const localFs = createFileSystem();

      const localImportPaths = await this.depValidator.processLocalImports(
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
              this.depValidator.missingDependencies.push({
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

      // Hold project slots only around the actual transform and file write.
      await this.withTransformCapacity(filePath, "build", async () => {
        const projectId = this.options.projectId;
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

        transformed = rewriteLocalImports(
          transformed,
          localImportPaths,
          filePath,
          this.options.projectDir,
        );

        transformed = await resolveVfModuleImports(transformed, {
          filePath,
          projectId: this.options.projectId,
          contentSourceId: this.options.contentSourceId!,
          adapter: this.options.adapter,
          projectDir: this.options.projectDir,
          reactVersion: this.options.reactVersion,
        });

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

        const transformedHash = await this.cache.hashContentAsync(transformed);

        const tempPath = await this.cache.getTempPath(filePath, transformedHash);
        const written = await writeCacheFile(
          this.cache.getFs(),
          tempPath,
          transformed,
          "SSR-MODULE-LOADER",
        );
        if (!written) {
          // Cache file write failed (directory removed concurrently or verification failed)
          return;
        }

        if (isSSRDistributedCacheEnabled()) {
          setInRedis(contentCacheKey, transformed, {
            isProduction: this.cache.isProductionContentSource(),
          }).catch((error) => {
            logger.debug("[SSR-MODULE-LOADER] Distributed cache set failed", {
              key: contentCacheKey,
              error,
            });
          });
        }

        const entry: ModuleCacheEntry = { tempPath, contentHash: transformedHash };
        globalModuleCache.set(contentCacheKey, entry);
        globalModuleCache.set(filePathCacheKey, entry);
      });

      resolveTransform();
    } catch (error) {
      rejectTransform(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      globalInProgress.delete(inProgressKey);
    }
  }
}
