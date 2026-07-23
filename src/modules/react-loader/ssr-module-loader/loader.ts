/**
 * SSR Module Loader Class
 *
 * Loads and transforms React components for server-side rendering.
 *
 * @module module-system/react-loader/ssr-module-loader/loader
 */

import type * as React from "react";
import { transformToESM } from "#veryfront/transforms/esm/index.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import {
  type CrossProjectImport,
  parseLocalImports,
} from "#veryfront/transforms/esm/import-parser.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { verifyCacheFileExists, writeCacheFile } from "#veryfront/utils/cache-file-ops.ts";
import {
  CACHE_ERROR,
  CIRCULAR_DEPENDENCY,
  DEPENDENCY_MISSING,
  IMPORT_RESOLUTION_ERROR,
  INVALID_ARGUMENT,
} from "#veryfront/errors";
import { rendererLogger } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { extractComponent } from "../extract-component.ts";
import {
  classifyImportError,
  createTransformCapacityError,
  type TransformCapacityErrorMode,
} from "./loader-helpers.ts";
import {
  getMaxConcurrentTransforms,
  IN_PROGRESS_WAIT_TIMEOUT_MS,
  MAX_SSR_IMPORTS_PER_MODULE,
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
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import {
  getMdxEsmSsrCacheDir,
  getMdxEsmSsrCacheDirs,
  invalidateMdxEsmModuleForCachedPath,
  lookupMdxEsmCache,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { ensureHttpBundlesExist } from "#veryfront/transforms/esm/http-cache.ts";
import {
  buildVerifiedHttpBundleKey,
  extractHttpBundlePaths,
  verifiedHttpBundlePaths,
} from "./http-bundle-helpers.ts";
import { rewriteCrossProjectImport, rewriteLocalImports } from "./import-rewriter.ts";
import {
  isCrossProjectUnavailableError,
  transformCrossProjectImportFlow,
} from "./cross-project-import-loader.ts";
import { SSRCacheManager } from "./ssr-cache-manager.ts";
import { SSRCircuitBreaker } from "./ssr-circuit-breaker.ts";
import { SSRDependencyValidator } from "./ssr-dependency-validator.ts";
import { preflightLocalImports } from "./preflight-imports.ts";
import { resolveVfModuleImports } from "./vf-module-resolver.ts";
import { registerCSSImport } from "../css-import-collector.ts";
import { injectNodePositions } from "#veryfront/transforms/plugins/babel-node-positions.ts";
import { ensureMdxModuleDependencies } from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/dependency-recovery.ts";
import {
  createDependencyHashCache,
  type DependencyHashCache,
} from "#veryfront/cache/dependency-graph.ts";
import { toFileUrl } from "#veryfront/compat/path/index.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const logger = rendererLogger.component("ssr-module-loader");
const CACHE_FILE_MISSING_PREFIX = "Cache file missing";
const MAX_SSR_MODULE_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_SSR_MODULE_PATH_LENGTH = 8_192;

function buildModuleImportUrl(
  path: string,
  contentHash: string,
  retry = false,
): string {
  const url = toFileUrl(path);
  url.searchParams.set("v", contentHash);
  if (retry) url.searchParams.set("retry", "1");
  return url.href;
}

function validateModuleInput(filePath: string, source: string): void {
  if (
    filePath.length === 0 || filePath.length > MAX_SSR_MODULE_PATH_LENGTH ||
    hasUnsafeControlCharacters(filePath)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "SSR module path is invalid" });
  }
  if (new TextEncoder().encode(source).byteLength > MAX_SSR_MODULE_SOURCE_BYTES) {
    throw INVALID_ARGUMENT.create({ detail: "SSR module source exceeds size limit" });
  }
}

/**
 * SSR Module Loader with Redis Support.
 *
 * Loads and transforms React components for server-side rendering.
 * Supports Redis caching to share transformed modules across pods.
 */
export class SSRModuleLoader {
  private cache: SSRCacheManager;
  private circuitBreaker = new SSRCircuitBreaker();

  constructor(private options: SSRModuleLoaderOptions) {
    this.cache = new SSRCacheManager(options);
  }

  private createDependencyValidator(): SSRDependencyValidator {
    let validator: SSRDependencyValidator | null = null;
    validator = new SSRDependencyValidator(
      (filePath) => this.cache.getCacheKey(filePath),
      (filePath, source, depth, dependencyHashCache, ancestry) => {
        if (!validator) {
          throw CACHE_ERROR.create({
            detail: "SSR dependency validator initialization failed",
          });
        }
        return this.transformWithDependencies(
          filePath,
          source,
          depth,
          dependencyHashCache,
          validator,
          ancestry,
        );
      },
      (crossImport) => this.transformCrossProjectImport(crossImport),
      this.options.adapter,
      this.options.projectDir,
    );
    return validator;
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

    // The per-project limit is noisy-neighbor protection for multi-tenant
    // cloud. The dev server is single-tenant, so the limit only produces
    // false "at capacity" failures when a cold-cache render fans out across
    // the framework tree. Bypass it in dev; the global semaphore still bounds
    // total concurrency.
    const bypassProjectLimit = this.options.dev === true;

    if (
      !await tryAcquireTransformSlot(projectId, TRANSFORM_ACQUIRE_TIMEOUT_MS, bypassProjectLimit)
    ) {
      throw createTransformCapacityError(
        mode,
        "Project transform capacity is temporarily exhausted. Reduce page complexity or request rate.",
        filePath,
      );
    }

    try {
      if (semaphore) {
        semaphoreAcquired = await semaphore.tryAcquire(TRANSFORM_ACQUIRE_TIMEOUT_MS);
        if (!semaphoreAcquired) {
          throw createTransformCapacityError(
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
      releaseTransformSlot(projectId, bypassProjectLimit);
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
      logger.debug("Cache file missing before import, invalidating");
      await this.invalidateMdxEsmCacheEntry(filePath, cacheEntry);
      this.cache.invalidateFilePathCacheEntry(filePath, cacheEntry);
      throw CACHE_ERROR.create({ detail: CACHE_FILE_MISSING_PREFIX });
    }

    try {
      return (await withSpan(
        SpanNames.SSR_DYNAMIC_IMPORT,
        () => import(buildModuleImportUrl(cacheEntry.tempPath, cacheEntry.contentHash)),
        { "ssr.file": fileName },
      )) as Record<string, unknown>;
    } catch (importError) {
      const classifiedError = classifyImportError(importError);

      if (classifiedError.type === "http-bundle-missing") {
        const hash = classifiedError.hash;
        const cacheDir = getHttpBundleCacheDir();

        logger.error("Missing HTTP bundle after ensureHttpBundlesExist", {
          hash,
        });

        const { recoverHttpBundleByHash } = await import(
          "#veryfront/transforms/esm/http-cache.ts"
        );
        const recovered = await recoverHttpBundleByHash(hash, cacheDir);

        if (recovered) {
          logger.info("HTTP bundle recovered, retrying import", {
            hash,
          });
          return (await import(
            buildModuleImportUrl(cacheEntry.tempPath, cacheEntry.contentHash, true)
          )) as Record<string, unknown>;
        }

        this.cache.invalidateFilePathCacheEntry(filePath, cacheEntry);

        logger.error("HTTP bundle recovery failed, cache invalidated", {
          hash,
        });
        throw CACHE_ERROR.create({ detail: "Required HTTP module bundle is unavailable" });
      }

      if (classifiedError.type === "module-not-found") {
        if (this.options.contentSourceId) {
          try {
            const cachedCode = await this.cache.getFs().readTextFile(cacheEntry.tempPath);
            const recovered = await ensureMdxModuleDependencies(cachedCode, {
              projectId: this.options.projectId,
              contentSourceId: this.options.contentSourceId,
              log: logger,
            });
            if (recovered.missing.length === 0 && recovered.recovered.length > 0) {
              const retryTempPath = cacheEntry.tempPath.replace(/\.mjs$/, "") +
                `-recovered-${cacheEntry.contentHash}.mjs`;
              const written = await writeCacheFile(
                this.cache.getFs(),
                retryTempPath,
                cachedCode,
                "SSR-MODULE-LOADER",
              );
              if (!written) {
                throw CACHE_ERROR.create({
                  detail: "Recovered SSR module cache write failed",
                });
              }
              logger.info("Recovered vfmod dependencies for cached SSR module, retrying import", {
                recoveredCount: recovered.recovered.length,
              });
              return (await import(
                buildModuleImportUrl(retryTempPath, cacheEntry.contentHash, true)
              )) as Record<string, unknown>;
            }
          } catch (recoveryError) {
            logger.debug("Failed to recover vfmod dependencies for cached SSR module", {
              errorName: recoveryError instanceof Error ? recoveryError.name : "UnknownError",
            });
          }
        }

        logger.error(
          "[SSR-MODULE-LOADER] Cached module has missing dependency, invalidating cache",
          {
            errorType: classifiedError.type,
          },
        );
        await this.invalidateMdxEsmCacheEntry(filePath, cacheEntry);
        this.cache.invalidateFilePathCacheEntry(filePath, cacheEntry);
      }

      throw importError;
    }
  }

  private getTransformedCacheEntry(filePath: string): ModuleCacheEntry {
    const cacheKey = this.cache.getCacheKey(filePath);
    const cacheEntry = globalModuleCache.get(cacheKey);
    if (!cacheEntry) {
      throw CACHE_ERROR.create({ detail: "Transformed SSR module cache entry is unavailable" });
    }
    return cacheEntry;
  }

  private async invalidateMdxEsmCacheEntry(
    filePath: string,
    cacheEntry: ModuleCacheEntry,
  ): Promise<void> {
    const { contentSourceId, projectId } = this.options;
    const mdxCacheDirs = projectId && contentSourceId
      ? getMdxEsmSsrCacheDirs(projectId, contentSourceId)
      : undefined;

    await invalidateMdxEsmModuleForCachedPath(
      cacheEntry.tempPath,
      filePath,
      this.options.projectDir,
      this.options.reactVersion,
      mdxCacheDirs,
    );
  }

  private throwMissingDependencies(
    validator: SSRDependencyValidator,
    filePath: string,
  ): void {
    if (validator.missingDependencies.length > 0) {
      validator.throwMissingDependencies(filePath);
    }
  }

  private getRetryableStaleCacheErrorMessage(error: unknown): string | null {
    const classifiedError = classifyImportError(error);
    if (classifiedError.type === "module-not-found") {
      return "module-not-found";
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(CACHE_FILE_MISSING_PREFIX)) return "cache-file-missing";

    return null;
  }

  loadRawModule(
    filePath: string,
    source: string,
  ): Promise<Record<string, unknown>> {
    validateModuleInput(filePath, source);
    const fileName = filePath.split("/").pop() || filePath;

    return withSpan(
      SpanNames.SSR_LOAD_MODULE,
      async () => {
        const circuitKey = this.cache.getCacheKey(filePath);
        this.circuitBreaker.check(circuitKey, filePath);
        const depValidator = this.createDependencyValidator();

        try {
          const dependencyHashCache = createDependencyHashCache();
          await this.transformWithDependencies(
            filePath,
            source,
            0,
            dependencyHashCache,
            depValidator,
          );
          this.throwMissingDependencies(depValidator, filePath);

          const cacheEntry = this.getTransformedCacheEntry(filePath);

          try {
            const mod = await this.importModuleFromCacheEntry(filePath, fileName, cacheEntry);

            this.circuitBreaker.recordSuccess(circuitKey);
            return mod;
          } catch (importError) {
            const retryErrorMessage = this.getRetryableStaleCacheErrorMessage(importError);
            if (!retryErrorMessage) throw importError;

            logger.warn("Retrying SSR module import after stale cache invalidation", {
              reason: retryErrorMessage,
            });

            const retryDependencyHashCache = createDependencyHashCache();
            const retryDepValidator = this.createDependencyValidator();
            await this.transformWithDependencies(
              filePath,
              source,
              0,
              retryDependencyHashCache,
              retryDepValidator,
            );
            this.throwMissingDependencies(retryDepValidator, filePath);

            const retryCacheEntry = this.getTransformedCacheEntry(filePath);
            let mod: Record<string, unknown>;
            try {
              mod = await this.importModuleFromCacheEntry(filePath, fileName, retryCacheEntry);
            } catch (retryError) {
              if (classifyImportError(retryError).type === "module-not-found") {
                throw DEPENDENCY_MISSING.create({
                  detail: "SSR module dependency could not be loaded",
                });
              }
              throw retryError;
            }

            this.circuitBreaker.recordSuccess(circuitKey);
            return mod;
          }
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

  async loadModule(
    filePath: string,
    source: string,
  ): Promise<React.ComponentType<Record<string, unknown>>> {
    const mod = await this.loadRawModule(filePath, source);
    return extractComponent(mod, filePath);
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
    dependencyHashCache: DependencyHashCache = createDependencyHashCache(),
    depValidator: SSRDependencyValidator = this.createDependencyValidator(),
    ancestry: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const fileName = filePath.split("/").pop() || filePath;

    return withSpan(
      SpanNames.SSR_TRANSFORM_DEPENDENCIES,
      () =>
        this.doTransformWithDependencies(
          filePath,
          source,
          depth,
          dependencyHashCache,
          depValidator,
          ancestry,
        ),
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
    dependencyHashCache: DependencyHashCache = createDependencyHashCache(),
    depValidator: SSRDependencyValidator = this.createDependencyValidator(),
    ancestry: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    if (ancestry.has(filePath)) {
      throw CIRCULAR_DEPENDENCY.create({
        detail: "Circular module dependency detected",
      });
    }

    if (depth > MAX_TRANSFORM_DEPTH) {
      logger.warn("Max transform depth exceeded", {
        depth,
        maxDepth: MAX_TRANSFORM_DEPTH,
      });
      throw IMPORT_RESOLUTION_ERROR.create({
        detail: `Module dependency graph exceeds the maximum depth of ${MAX_TRANSFORM_DEPTH}`,
      });
    }

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(filePath);

    let code = source ?? (await this.options.adapter.fs.readFile(filePath));

    // Inject node positions for JSX files in dev or preview mode
    const shouldInjectPositions = this.options.dev || this.options.mode === "preview";
    if (shouldInjectPositions && /\.(tsx|jsx)$/i.test(filePath)) {
      const relativeFilePath = filePath.startsWith(this.options.projectDir)
        ? filePath.slice(this.options.projectDir.length).replace(/^\/+/, "")
        : filePath;
      code = injectNodePositions(code, { filePath: relativeFilePath });
    }

    const contentHash = await this.cache.hashContentAsync(code);
    const contentCacheKey = this.cache.getContentCacheKey(filePath, contentHash);
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
        await depValidator.ensureDependenciesExist(code, filePath, depth, nextAncestry);
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
            verifiedHttpBundlePaths.set(
              buildVerifiedHttpBundleKey(tempPath, transformedHash),
              true,
            );

            const entry: ModuleCacheEntry = { tempPath, contentHash: transformedHash };
            globalModuleCache.set(contentCacheKey, entry);
            globalModuleCache.set(filePathCacheKey, entry);

            logger.debug("Redis cache hit");

            await depValidator.ensureDependenciesExist(code, filePath, depth, nextAncestry);
            return;
          }
          // writeCacheFile returned false — fall through to fresh transform
        }
      }
    }

    if (this.options.projectId && this.options.contentSourceId) {
      const mdxCacheDir = getMdxEsmSsrCacheDir(
        this.options.projectId,
        this.options.contentSourceId,
      );

      const mdxCacheResult = await lookupMdxEsmCache(
        filePath,
        mdxCacheDir,
        this.options.projectDir,
        contentHash,
        {
          projectId: this.options.projectId,
          contentSourceId: this.options.contentSourceId,
        },
        this.options.reactVersion,
      );

      if (mdxCacheResult.status === "hit") {
        const entry: ModuleCacheEntry = { tempPath: mdxCacheResult.path, contentHash };
        globalModuleCache.set(contentCacheKey, entry);
        globalModuleCache.set(filePathCacheKey, entry);

        logger.debug("Reusing MDX-ESM cache", {
          cacheStatus: mdxCacheResult.status,
        });

        await depValidator.ensureDependenciesExist(code, filePath, depth, nextAncestry);
        return;
      }

      if (mdxCacheResult.status === "corrupted") {
        logger.warn("MDX-ESM cache corrupted, re-transforming");
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
              `Waiting for in-progress transform of ${filePath.split("/").pop() || "module"}`,
            ),
          { "ssr.file": filePath.split("/").pop() || filePath },
        );
        await depValidator.ensureDependenciesExist(code, filePath, depth, nextAncestry);
        return;
      } catch (error) {
        if (globalInProgress.get(inProgressKey) !== existingTransform) {
          throw error;
        }
        globalInProgress.delete(inProgressKey);
        logger.warn("In-progress transform timed out, retrying", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }

    let resolveTransform!: () => void;
    let rejectTransform!: (err: Error) => void;
    const transformPromise = new Promise<void>((resolve, reject) => {
      resolveTransform = resolve;
      rejectTransform = reject;
    });
    // Attach catch to prevent unhandled rejection when waiters timeout
    // and stop listening. The actual error is thrown to the caller directly.
    transformPromise.catch((err) => {
      logger.debug("Transform rejected (waiters may have timed out)", {
        errorName: err instanceof Error ? err.name : "UnknownError",
      });
    });
    globalInProgress.set(inProgressKey, transformPromise);

    try {
      let parseResult = await parseLocalImports(
        code,
        filePath,
        this.options.projectDir,
        this.options.adapter,
      );
      if (
        parseResult.imports.length + parseResult.cssImports.length +
            parseResult.crossProjectImports.length + parseResult.missing.length >
          MAX_SSR_IMPORTS_PER_MODULE
      ) {
        throw IMPORT_RESOLUTION_ERROR.create({
          detail: `Module exceeds the import limit of ${MAX_SSR_IMPORTS_PER_MODULE}`,
        });
      }

      // Register CSS imports for later inclusion in HTML output.
      // CSS files are not JS modules — skip them in the dependency graph.
      for (const cssImport of parseResult.cssImports) {
        registerCSSImport(cssImport.absolutePath);
      }

      if (parseResult.missing.length > 0) {
        depValidator.addMissingDependencies(...parseResult.missing);
      }

      if (parseResult.imports.length > 0) {
        const { validImports, missingImports: preflightMissing } = await preflightLocalImports(
          parseResult.imports,
          filePath,
          this.options.adapter.fs,
        );

        if (preflightMissing.length > 0) {
          logger.warn("Pre-flight: some dependencies missing, skipping them", {
            missingCount: preflightMissing.length,
            depth,
          });
          depValidator.addMissingDependencies(...preflightMissing);
          parseResult = { ...parseResult, imports: validImports };
        }
      }

      // Process recursive imports FIRST, without holding a project slot.
      // Each recursive child acquires its own slot for its own transform only.
      // This prevents hierarchical deadlock where parent holds a slot while
      // children also need slots (10 batch x 2 depth = 21 slots, but limit is 17).
      const crossProjectPaths = new Map<string, string>();
      const localFs = createFileSystem();

      const localImportPaths = await depValidator.processLocalImports(
        parseResult.imports,
        filePath,
        depth,
        localFs,
        dependencyHashCache,
        nextAncestry,
      );

      for (let i = 0; i < parseResult.crossProjectImports.length; i += TRANSFORM_BATCH_SIZE) {
        const batch = parseResult.crossProjectImports.slice(i, i + TRANSFORM_BATCH_SIZE);
        await Promise.all(
          batch.map(async (crossImport) => {
            try {
              const tempPath = await this.transformCrossProjectImport(crossImport);
              crossProjectPaths.set(crossImport.specifier, tempPath);
            } catch (error) {
              if (!isCrossProjectUnavailableError(error)) throw error;
              depValidator.addMissingDependencies({
                specifier: crossImport.specifier,
                fromFile: filePath,
                reason: "Cross-project import could not be loaded",
              });
            }
          }),
        );
      }

      this.throwMissingDependencies(depValidator, filePath);

      // Hold project slots only around the actual transform and file write.
      await this.withTransformCapacity(filePath, "build", async () => {
        const projectId = this.options.projectId;
        const transformOpts: TransformOptions = {
          projectId,
          dev: this.options.dev,
          ssr: true,
          apiBaseUrl: this.options.apiBaseUrl,
          reactVersion: this.options.reactVersion,
          dependencyHashCache,
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
          transformed = await rewriteCrossProjectImport(transformed, specifier, tempPath);
        }

        transformed = await rewriteLocalImports(
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
            logger.error("Unrecoverable HTTP bundles", {
              failedCount: failed.length,
              totalBundles: bundlePaths.length,
              source: "fresh-transform",
            });
            throw CACHE_ERROR.create({
              detail: `Required HTTP module bundles are unavailable (${failed.length})`,
            });
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
          throw CACHE_ERROR.create({ detail: "SSR module cache write failed" });
        }

        if (isSSRDistributedCacheEnabled()) {
          void setInRedis(contentCacheKey, transformed, {
            isProduction: this.cache.isProductionContentSource(),
          }).catch((error) => {
            logger.debug("Distributed cache set failed", {
              errorName: error instanceof Error ? error.name : "UnknownError",
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
      if (globalInProgress.get(inProgressKey) === transformPromise) {
        globalInProgress.delete(inProgressKey);
      }
    }
  }
}
