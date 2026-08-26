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
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { verifyCacheFileExists, writeCacheFile } from "#veryfront/utils/cache-file-ops.ts";
import { createError, toError } from "#veryfront/errors";
import { rendererLogger, throwIfAborted } from "#veryfront/utils";
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
  getTransformAcquireTimeoutMs,
  MAX_TRANSFORM_DEPTH,
  TRANSFORM_IN_PROGRESS_STALE_EVICTION_MS,
  TRANSFORM_IN_PROGRESS_WAIT_TIMEOUT_MS,
} from "./constants.ts";
import {
  getFromRedis,
  getTransformSemaphore,
  globalInProgress,
  globalModuleCache,
  isSSRDistributedCacheEnabled,
  releaseTransformSlot,
  setInRedis,
  trackBackgroundWrite,
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
import { extractHttpBundlePaths, verifiedHttpBundlePaths } from "./http-bundle-helpers.ts";
import { rewriteCrossProjectImport, rewriteLocalImports } from "./import-rewriter.ts";
import { transformCrossProjectImportFlow } from "./cross-project-import-loader.ts";
import { SSRCacheManager } from "./ssr-cache-manager.ts";
import { SSRCircuitBreaker } from "./ssr-circuit-breaker.ts";
import {
  cachedCodeUsesResolvedDependencies,
  type DependencyTransformCacheOptions,
  SSRDependencyValidator,
} from "./ssr-dependency-validator.ts";
import { preflightLocalImports } from "./preflight-imports.ts";
import { resolveVfModuleImports } from "./vf-module-resolver.ts";
import { injectNodePositions } from "#veryfront/transforms/plugins/babel-node-positions.ts";
import { ensureMdxModuleDependencies } from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/dependency-recovery.ts";
import {
  createDependencyHashCache,
  type DependencyHashCache,
} from "#veryfront/cache/dependency-graph.ts";
import { getMdxModuleCacheVariant } from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/cache-keys.ts";
import { composeAbortSignals } from "#veryfront/extensions/abort-signal.ts";

const logger = rendererLogger.component("ssr-module-loader");
const CACHE_FILE_MISSING_PREFIX = "Cache file missing:";
const MAX_REJECTED_IN_PROGRESS_RETRIES = 1;

class InProgressTransformWaitTimeoutError extends Error {
  constructor(filePath: string) {
    super(
      `Timed out waiting for in-progress SSR transform after ${TRANSFORM_IN_PROGRESS_WAIT_TIMEOUT_MS}ms: ${
        filePath.split("/").pop() || filePath
      }`,
    );
    this.name = "InProgressTransformWaitTimeoutError";
  }
}

function deleteInProgressTransformIfCurrent(
  key: string,
  transformPromise: Promise<ModuleCacheEntry>,
): boolean {
  if (globalInProgress.get(key) !== transformPromise) return false;
  return globalInProgress.delete(key);
}

interface InProgressTransformObserverState {
  key: string;
  transformPromise: Promise<ModuleCacheEntry>;
  controller: AbortController;
  observerCount: number;
  settled: boolean;
}

const inProgressTransformObservers = new WeakMap<
  Promise<ModuleCacheEntry>,
  InProgressTransformObserverState
>();
const retainedInProgressTransformLeaders = new WeakSet<Promise<ModuleCacheEntry>>();

function signalAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function registerInProgressTransformObservers(
  key: string,
  transformPromise: Promise<ModuleCacheEntry>,
): AbortSignal {
  const existing = inProgressTransformObservers.get(transformPromise);
  if (existing) return existing.controller.signal;

  const state: InProgressTransformObserverState = {
    key,
    transformPromise,
    controller: new AbortController(),
    observerCount: 0,
    settled: false,
  };
  inProgressTransformObservers.set(transformPromise, state);
  return state.controller.signal;
}

function markInProgressTransformSettled(transformPromise: Promise<ModuleCacheEntry>): void {
  const state = inProgressTransformObservers.get(transformPromise);
  if (state) state.settled = true;
}

function inProgressTransformObserverCount(
  transformPromise: Promise<ModuleCacheEntry>,
): number {
  return inProgressTransformObservers.get(transformPromise)?.observerCount ?? 0;
}

function shouldRetryRejectedInProgressTransform(rejectedLeaderCount: number): boolean {
  return rejectedLeaderCount <= MAX_REJECTED_IN_PROGRESS_RETRIES;
}

function scheduleStaleInProgressTransformEviction(
  key: string,
  transformPromise: Promise<ModuleCacheEntry>,
  filePath: string,
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    if (!deleteInProgressTransformIfCurrent(key, transformPromise)) return;
    logger.warn("Evicted stalled in-progress transform", {
      file: logPath(filePath),
      timeoutMs: TRANSFORM_IN_PROGRESS_STALE_EVICTION_MS,
    });
  }, TRANSFORM_IN_PROGRESS_STALE_EVICTION_MS);
  unrefTimer(timer);
  return timer;
}

function publishTransformCacheIfCurrent(input: {
  inProgressKey: string;
  transformPromise: Promise<ModuleCacheEntry>;
  staleEvictionTimer: ReturnType<typeof setTimeout>;
  contentCacheKey: string;
  filePathCacheKey: string;
  entry: ModuleCacheEntry;
  publishDistributed?: () => void;
}): boolean {
  if (globalInProgress.get(input.inProgressKey) !== input.transformPromise) {
    return false;
  }

  // Once the current leader reaches synchronous publication, do not let the
  // stale-flight timer create a replacement between the identity check and the
  // cache writes below.
  clearTimeout(input.staleEvictionTimer);
  input.publishDistributed?.();
  globalModuleCache.set(input.contentCacheKey, input.entry);
  globalModuleCache.set(input.filePathCacheKey, input.entry);
  return true;
}

/** Keep a failed singleflight reserved until its abandoned transform settles. */
function retainInProgressTransformUntilSettled(
  key: string,
  leader: Promise<ModuleCacheEntry>,
  transformSettlement: Promise<void>,
  error: unknown,
): Promise<ModuleCacheEntry> | null {
  if (globalInProgress.get(key) !== leader) return null;
  const retainedError = error instanceof Error ? error : new Error(String(error));
  const retained = transformSettlement.then<ModuleCacheEntry>(() => {
    throw retainedError;
  });
  retainedInProgressTransformLeaders.add(leader);
  globalInProgress.set(key, retained);
  void retained.then(
    () => deleteInProgressTransformIfCurrent(key, retained),
    () => deleteInProgressTransformIfCurrent(key, retained),
  );
  return retained;
}

function wasRetainedInProgressTransformLeader(
  leader: Promise<ModuleCacheEntry>,
): boolean {
  return retainedInProgressTransformLeaders.has(leader);
}

function getMdxEsmCacheVariant(
  options: Pick<
    SSRModuleLoaderOptions,
    "dependencyPinningCacheKey" | "moduleServerOrigin" | "serverExternalPackages" | "dev"
  >,
): string | undefined {
  return getMdxModuleCacheVariant(
    options.dependencyPinningCacheKey,
    options.moduleServerOrigin,
    options.serverExternalPackages,
    options.dev,
  );
}

type SettledOperation<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

function startSettledOperation<T>(operation: () => Promise<T>): Promise<SettledOperation<T>> {
  try {
    return operation().then(
      (value) => ({ ok: true, value }),
      (error: unknown) => ({ ok: false, error }),
    );
  } catch (error) {
    return Promise.resolve({ ok: false, error });
  }
}

/**
 * Start compilation before walking dependencies, then join both results.
 *
 * Compiler settlement handlers are attached immediately, so dependency
 * resolution can retain its historical error precedence without draining a
 * compiler that cannot be aborted.
 */
async function runTransformAndDependencies<T, D>(
  transform: () => Promise<T>,
  dependencies: () => Promise<D>,
  onDependencyFailure?: (error: unknown, transformSettlement: Promise<void>) => void,
): Promise<{ transformed: T; dependencies: D }> {
  const transformResult = startSettledOperation(transform);

  let resolvedDependencies: D;
  try {
    resolvedDependencies = await dependencies();
  } catch (dependencyError) {
    onDependencyFailure?.(
      dependencyError,
      transformResult.then(() => undefined),
    );
    throw dependencyError;
  }

  const settledTransform = await transformResult;
  if (!settledTransform.ok) throw settledTransform.error;
  return {
    transformed: settledTransform.value,
    dependencies: resolvedDependencies,
  };
}

/** Internal test seam for the singleflight timeout lifecycle. */
export const __ssrModuleLoaderInternals = {
  deleteInProgressTransformIfCurrent,
  getMdxEsmCacheVariant,
  inProgressTransformObserverCount,
  publishTransformCacheIfCurrent,
  registerInProgressTransformObservers,
  retainInProgressTransformUntilSettled,
  runTransformAndDependencies,
  scheduleStaleInProgressTransformEviction,
  shouldRetryRejectedInProgressTransform,
  waitForInProgressTransform,
};

async function waitForInProgressTransform(
  transformPromise: Promise<ModuleCacheEntry>,
  filePath: string,
  signal?: AbortSignal,
): Promise<ModuleCacheEntry> {
  const observerState = inProgressTransformObservers.get(transformPromise);
  if (observerState) observerState.observerCount++;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let releaseReason: unknown;
  let removeAbortListener: (() => void) | undefined;
  try {
    const waits: Promise<ModuleCacheEntry>[] = [
      transformPromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          releaseReason = new InProgressTransformWaitTimeoutError(filePath);
          reject(releaseReason);
        }, TRANSFORM_IN_PROGRESS_WAIT_TIMEOUT_MS);
      }),
    ];

    if (signal) {
      waits.push(
        new Promise<never>((_, reject) => {
          const onAbort = (): void => {
            releaseReason = signalAbortReason(signal);
            reject(releaseReason);
          };
          signal.addEventListener("abort", onAbort, { once: true });
          removeAbortListener = () => signal.removeEventListener("abort", onAbort);
          if (signal.aborted) onAbort();
        }),
      );
    }

    return await Promise.race(waits);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    removeAbortListener?.();
    if (observerState) {
      observerState.observerCount--;
      if (
        observerState.observerCount === 0 && !observerState.settled &&
        !observerState.controller.signal.aborted
      ) {
        observerState.controller.abort(releaseReason);
        deleteInProgressTransformIfCurrent(
          observerState.key,
          observerState.transformPromise,
        );
      }
    }
  }
}

/**
 * Shorten a path for a log line without letting it read as a real one.
 *
 * The bare `slice(-40)` this replaces emitted entries like
 * `veryfront/esm/src/react/context/index.js` and
 * `/veryfront/esm/src/react/router/index.js`: two different files whose tails
 * differ only by a leading slash. Reading those side by side, one failure of
 * two distinct modules looks like two modules colliding on one cache key,
 * which is a materially different bug. The marker keeps the entry short while
 * making the truncation visible.
 *
 * @internal exported for tests
 */
export function logPath(filePath: string): string {
  return filePath.length <= 40 ? filePath : `…${filePath.slice(-40)}`;
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
  private depValidator: SSRDependencyValidator;

  constructor(private options: SSRModuleLoaderOptions) {
    this.cache = new SSRCacheManager(options);
    this.depValidator = new SSRDependencyValidator(
      (filePath, source, depth, dependencyHashCache, signal, cacheOptions) =>
        this.transformWithDependencies(
          filePath,
          source,
          depth,
          dependencyHashCache,
          signal,
          cacheOptions,
        ),
      (crossImport, signal) => this.transformCrossProjectImport(crossImport, signal),
      options.adapter,
      options.projectDir,
    );
  }

  private async withTransformCapacity<T>(
    filePath: string,
    mode: TransformCapacityErrorMode,
    operation: () => Promise<T>,
    signal?: AbortSignal,
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
    const dev = this.options.dev === true;
    const bypassProjectLimit = dev;

    // Dev queues on the global semaphore instead of failing the render, so a
    // burst of concurrent refreshes is slower rather than an error page.
    // Production keeps the short deadline as multi-tenant back-pressure.
    const acquireTimeoutMs = getTransformAcquireTimeoutMs(dev);

    if (
      !await tryAcquireTransformSlot(projectId, acquireTimeoutMs, bypassProjectLimit, signal)
    ) {
      throw createTransformCapacityError(
        mode,
        `Project ${projectId} at transform capacity. Consider reducing page complexity or request rate.`,
        filePath,
      );
    }

    try {
      if (semaphore) {
        const report = await semaphore.tryAcquireWithReport(acquireTimeoutMs, { signal });
        semaphoreAcquired = report.acquired;
        if (!semaphoreAcquired) {
          throw createTransformCapacityError(
            mode,
            `Transform capacity exceeded (${report.waiting} waiting). Service is overloaded.`,
            filePath,
          );
        }
      }

      throwIfAborted(signal);
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
    let fileExists: boolean;
    try {
      fileExists = await verifyCacheFileExists(
        this.cache.getFs(),
        cacheEntry.tempPath,
        "SSR-MODULE-LOADER",
      );
    } catch (error) {
      // An unreadable cache entry cannot be trusted on a later attempt. Keep
      // the original operational error, but remove both indexes so a repaired
      // filesystem does not keep routing requests back to stale metadata.
      try {
        await this.invalidateMdxEsmCacheEntry(filePath, cacheEntry);
      } catch (invalidationError) {
        logger.warn("Failed to invalidate unreadable MDX cache entry", {
          file: logPath(filePath),
          error: invalidationError,
        });
      }
      try {
        this.cache.invalidateFilePathCacheEntry(filePath, cacheEntry);
      } catch (invalidationError) {
        logger.warn("Failed to invalidate unreadable file-path cache entry", {
          file: logPath(filePath),
          error: invalidationError,
        });
      }
      throw error;
    }
    if (!fileExists) {
      logger.debug("Cache file missing before import, invalidating", {
        file: logPath(filePath),
        tempPath: cacheEntry.tempPath,
        contentHash: cacheEntry.contentHash,
      });
      await this.invalidateMdxEsmCacheEntry(filePath, cacheEntry);
      this.cache.invalidateFilePathCacheEntry(filePath, cacheEntry);
      throw toError(
        createError({
          type: "build",
          message: `${CACHE_FILE_MISSING_PREFIX} ${cacheEntry.tempPath}`,
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
      const classifiedError = classifyImportError(importError);

      if (classifiedError.type === "http-bundle-missing") {
        const hash = classifiedError.hash;
        const cacheDir = getHttpBundleCacheDir();

        logger.error("Missing HTTP bundle after ensureHttpBundlesExist", {
          file: logPath(filePath),
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
          logger.info("HTTP bundle recovered, retrying import", {
            hash,
            file: logPath(filePath),
          });
          return (await import(
            `file://${cacheEntry.tempPath}?v=${cacheEntry.contentHash}&retry=1`
          )) as Record<string, unknown>;
        }

        this.cache.invalidateFilePathCacheEntry(filePath, cacheEntry);

        logger.error("HTTP bundle recovery failed, cache invalidated", {
          hash,
          file: logPath(filePath),
          cacheDir,
          hint: isSSRDistributedCacheEnabled()
            ? "The bundle may have expired from the distributed cache (24h TTL) while the transform stayed cached locally"
            : "The transform is cached but its bundle is absent from the local cache directory; the entry has been invalidated so the next request rebuilds it",
        });
        throw importError;
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
              await this.cache.getFs().writeTextFile(retryTempPath, cachedCode);
              logger.info("Recovered vfmod dependencies for cached SSR module, retrying import", {
                file: logPath(filePath),
                recovered: recovered.recovered.slice(0, 5),
                retryTempPath,
              });
              return (await import(
                `file://${retryTempPath}?v=${cacheEntry.contentHash}&retry=1`
              )) as Record<string, unknown>;
            }
          } catch (recoveryError) {
            logger.debug("Failed to recover vfmod dependencies for cached SSR module", {
              file: logPath(filePath),
              error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
            });
          }
        }

        logger.error(
          "[SSR-MODULE-LOADER] Cached module has missing dependency, invalidating cache",
          {
            file: logPath(filePath),
            tempPath: cacheEntry.tempPath,
            error: classifiedError.message.slice(0, 200),
          },
        );
        await this.invalidateMdxEsmCacheEntry(filePath, cacheEntry);
        this.cache.invalidateFilePathCacheEntry(filePath, cacheEntry);
      }

      throw importError;
    }
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
      getMdxEsmCacheVariant(this.options),
    );
  }

  private throwMissingDependencies(filePath: string): void {
    if (this.depValidator.missingDependencies.length > 0) {
      this.depValidator.throwMissingDependencies(filePath);
    }
  }

  private getRetryableStaleCacheErrorMessage(error: unknown): string | null {
    const classifiedError = classifyImportError(error);
    if (classifiedError.type === "module-not-found") {
      return classifiedError.message;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(CACHE_FILE_MISSING_PREFIX)) return message;

    return null;
  }

  loadRawModule(
    filePath: string,
    source: string,
  ): Promise<Record<string, unknown>> {
    const fileName = filePath.split("/").pop() || filePath;

    return withSpan(
      SpanNames.SSR_LOAD_MODULE,
      async () => {
        const circuitKey = this.cache.getCacheKey(filePath);
        this.circuitBreaker.check(circuitKey, filePath);

        this.depValidator.reset();

        try {
          const dependencyHashCache = createDependencyHashCache();
          const cacheEntry = await this.transformWithDependencies(
            filePath,
            source,
            0,
            dependencyHashCache,
            this.options.signal,
          );
          this.throwMissingDependencies(filePath);

          try {
            const mod = await this.importModuleFromCacheEntry(filePath, fileName, cacheEntry);

            this.circuitBreaker.recordSuccess(circuitKey);
            return mod;
          } catch (importError) {
            const retryErrorMessage = this.getRetryableStaleCacheErrorMessage(importError);
            if (!retryErrorMessage) throw importError;

            logger.warn("Retrying SSR module import after stale cache invalidation", {
              file: logPath(filePath),
              tempPath: cacheEntry.tempPath,
              error: retryErrorMessage.slice(0, 200),
            });

            const retryDependencyHashCache = createDependencyHashCache();
            const retryCacheEntry = await this.transformWithDependencies(
              filePath,
              source,
              0,
              retryDependencyHashCache,
              this.options.signal,
              { skipDistributedCache: true, skipMdxPathCache: true },
            );
            this.throwMissingDependencies(filePath);
            const mod = await this.importModuleFromCacheEntry(filePath, fileName, retryCacheEntry);

            this.circuitBreaker.recordSuccess(circuitKey);
            return mod;
          }
        } catch (error) {
          const requestCancelled = this.options.signal?.aborted === true &&
            (error === this.options.signal.reason ||
              (error instanceof Error && error.name === "AbortError"));
          if (!requestCancelled) this.circuitBreaker.recordFailure(circuitKey);
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
    signal?: AbortSignal,
  ): Promise<string> {
    return transformCrossProjectImportFlow({
      crossProjectImport,
      options: this.options,
      cache: this.cache,
      withTransformCapacity: (syntheticFilePath, operation) =>
        this.withTransformCapacity(syntheticFilePath, "plain", operation, signal),
    });
  }

  private transformWithDependencies(
    filePath: string,
    source?: string,
    depth: number = 0,
    dependencyHashCache: DependencyHashCache = createDependencyHashCache(),
    signal?: AbortSignal,
    options?: DependencyTransformCacheOptions,
  ): Promise<ModuleCacheEntry> {
    const fileName = filePath.split("/").pop() || filePath;

    return withSpan(
      SpanNames.SSR_TRANSFORM_DEPENDENCIES,
      () =>
        this.doTransformWithDependencies(
          filePath,
          source,
          depth,
          dependencyHashCache,
          signal,
          options,
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
    observerSignal?: AbortSignal,
    options?: DependencyTransformCacheOptions,
  ): Promise<ModuleCacheEntry> {
    throwIfAborted(observerSignal);
    if (depth > MAX_TRANSFORM_DEPTH) {
      logger.warn("Max transform depth exceeded", {
        file: logPath(filePath),
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
        await this.depValidator.ensureDependenciesExist(code, filePath, depth, observerSignal);
        return cachedEntry;
      }
    }

    if (!options?.skipDistributedCache && isSSRDistributedCacheEnabled()) {
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
          const resolvedDependencies = await this.depValidator.ensureDependenciesExist(
            code,
            filePath,
            depth,
            observerSignal,
          );
          if (!await cachedCodeUsesResolvedDependencies(redisCode, resolvedDependencies)) {
            logger.debug("Distributed cache has stale dependency outputs, re-transforming", {
              file: logPath(filePath),
            });
          } else {
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

              logger.debug("Redis cache hit", { file: logPath(filePath) });

              return entry;
            }
            // writeCacheFile returned false — fall through to fresh transform
          }
        }
      }
    }

    if (!options?.skipMdxPathCache && this.options.projectId && this.options.contentSourceId) {
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
        getMdxEsmCacheVariant(this.options),
      );

      if (mdxCacheResult.status === "hit") {
        const entry: ModuleCacheEntry = { tempPath: mdxCacheResult.path, contentHash };
        globalModuleCache.set(contentCacheKey, entry);
        globalModuleCache.set(filePathCacheKey, entry);

        logger.debug("Reusing MDX-ESM cache", {
          file: logPath(filePath),
          cachedPath: mdxCacheResult.path.slice(-60),
        });

        await this.depValidator.ensureDependenciesExist(code, filePath, depth, observerSignal);
        return entry;
      }

      if (mdxCacheResult.status === "corrupted") {
        logger.warn("MDX-ESM cache corrupted, re-transforming", {
          file: logPath(filePath),
          reason: mdxCacheResult.reason,
        });
      }
    }

    let rejectedInProgressLeaders = 0;
    while (true) {
      const existingTransform = globalInProgress.get(inProgressKey);
      if (!existingTransform) break;

      try {
        return await withSpan(
          SpanNames.SSR_WAIT_IN_PROGRESS,
          () => waitForInProgressTransform(existingTransform, filePath, observerSignal),
          { "ssr.file": filePath.split("/").pop() || filePath },
        );
      } catch (error) {
        if (observerSignal?.aborted) throw signalAbortReason(observerSignal);
        if (error instanceof InProgressTransformWaitTimeoutError) {
          logger.warn("In-progress transform wait timed out", {
            file: logPath(filePath),
            error: error.message,
          });
          // Detach this caller without deleting the shared leader. The leader
          // owns a separate last-resort eviction timer, so healthy slow work is
          // not multiplied into competing retries.
          throw error;
        }
        // Callers already joined to this failed leader receive its dependency
        // error now. The replacement only reserves capacity for new callers.
        if (wasRetainedInProgressTransformLeader(existingTransform)) {
          throw error;
        }

        // Retry only after the leader actually rejects. A time-based retry can
        // delete live singleflight state and multiply one slow cold transform
        // into many competing transforms; the outer render deadline already
        // bounds how long an individual request waits.
        deleteInProgressTransformIfCurrent(inProgressKey, existingTransform);
        rejectedInProgressLeaders += 1;
        if (!shouldRetryRejectedInProgressTransform(rejectedInProgressLeaders)) {
          logger.warn("In-progress transform failed after retry, propagating", {
            file: logPath(filePath),
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
        logger.warn("In-progress transform failed, retrying", {
          file: logPath(filePath),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let resolveTransform!: (entry: ModuleCacheEntry) => void;
    let rejectTransform!: (err: Error) => void;
    const transformPromise = new Promise<ModuleCacheEntry>((resolve, reject) => {
      resolveTransform = resolve;
      rejectTransform = reject;
    });
    // The coordinating promise is separate from the leader's direct call, so
    // it may reject when no follower is currently awaiting it.
    transformPromise.catch((err) => {
      logger.debug("Transform rejected (no active waiter may remain)", {
        key: inProgressKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    globalInProgress.set(inProgressKey, transformPromise);
    const sharedSignal = registerInProgressTransformObservers(inProgressKey, transformPromise);
    const leaderWait = waitForInProgressTransform(
      transformPromise,
      filePath,
      observerSignal,
    );
    const staleEvictionTimer = scheduleStaleInProgressTransformEviction(
      inProgressKey,
      transformPromise,
      filePath,
    );

    const runTransformLeader = async (): Promise<void> => {
      try {
        throwIfAborted(sharedSignal);
        let parseResult = await parseLocalImports(
          code,
          filePath,
          this.options.projectDir,
          this.options.adapter,
        );

        // Register CSS imports for later inclusion in HTML output.
        // CSS files are not JS modules — skip them in the dependency graph.
        for (const cssImport of parseResult.cssImports) {
          this.depValidator.registerContainedCSSImport(cssImport);
        }

        if (parseResult.missing.length > 0) {
          this.depValidator.missingDependencies.push(...parseResult.missing);
        }

        if (parseResult.imports.length > 0) {
          const { validImports, missingImports: preflightMissing } = await preflightLocalImports(
            parseResult.imports,
            filePath,
            this.options.adapter.fs,
          );

          if (preflightMissing.length > 0) {
            logger.warn("Pre-flight: some dependencies missing, skipping them", {
              file: logPath(filePath),
              missing: preflightMissing.map((m) => m.specifier),
              depth,
            });
            this.depValidator.missingDependencies.push(...preflightMissing);
            parseResult = { ...parseResult, imports: validImports };
          }
        }

        const projectId = this.options.projectId;
        const transformOpts: TransformOptions = {
          projectId,
          dev: this.options.dev,
          ssr: true,
          apiBaseUrl: this.options.apiBaseUrl,
          moduleServerOrigin: this.options.moduleServerOrigin,
          reactVersion: this.options.reactVersion,
          serverExternalPackages: this.options.serverExternalPackages,
          dependencyHashCache,
          dependencyPinningCacheKey: this.options.dependencyPinningCacheKey,
          dependencyPinningDependencies: this.options.dependencyPinningDependencies,
          dependencyPinningSource: this.options.dependencyPinningSource,
        };
        const localFs = createFileSystem();

        const resolveDependencies = async () => {
          const localImportPaths = await this.depValidator.processLocalImports(
            parseResult.imports,
            filePath,
            depth,
            localFs,
            dependencyHashCache,
            sharedSignal,
            options,
          );
          const crossProjectPaths = await this.depValidator.processCrossProjectImports(
            parseResult.crossProjectImports,
            filePath,
            sharedSignal,
          );
          return { localImportPaths, crossProjectPaths };
        };
        const compile = async (signal: AbortSignal): Promise<string> => {
          const transformed = await withSpan(
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
          throwIfAborted(signal);
          return transformed;
        };
        const finishTransform = async (
          compiled: string,
          dependencies: Awaited<ReturnType<typeof resolveDependencies>>,
        ): Promise<ModuleCacheEntry> => {
          throwIfAborted(sharedSignal);
          const { localImportPaths, crossProjectPaths } = dependencies;
          let transformed = compiled;

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
            dev: this.options.dev,
            reactVersion: this.options.reactVersion,
            moduleServerOrigin: this.options.moduleServerOrigin,
            dependencyPinningCacheKey: this.options.dependencyPinningCacheKey,
            dependencyPinningDependencies: this.options.dependencyPinningDependencies,
            dependencyPinningSource: this.options.dependencyPinningSource,
          });

          // Ensure HTTP bundles exist for this transform (handles nested bundle deps)
          const bundlePaths = extractHttpBundlePaths(transformed);
          if (bundlePaths.length > 0) {
            const cacheDir = getHttpBundleCacheDir();
            const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
            if (failed.length > 0) {
              logger.error("Unrecoverable HTTP bundles", {
                file: logPath(filePath),
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
            throw toError(
              createError({
                type: "build",
                message: `Failed to transform module: ${filePath}`,
                context: { file: filePath, phase: "transform" },
              }),
            );
          }

          const entry: ModuleCacheEntry = { tempPath, contentHash: transformedHash };
          throwIfAborted(sharedSignal);
          const published = publishTransformCacheIfCurrent({
            inProgressKey,
            transformPromise,
            staleEvictionTimer,
            contentCacheKey,
            filePathCacheKey,
            entry,
            ...(isSSRDistributedCacheEnabled()
              ? {
                publishDistributed: () => {
                  // Deliberately not awaited: a render must not block on a cache
                  // write. Tracked so the write is still reachable -- otherwise
                  // it outlives its cache directory and fails into a cleanup
                  // path nobody is waiting on.
                  trackBackgroundWrite(
                    setInRedis(contentCacheKey, transformed, {
                      isProduction: this.cache.isProductionContentSource(),
                    }).catch((error) => {
                      logger.debug("Distributed cache set failed", {
                        key: contentCacheKey,
                        error,
                      });
                    }),
                  );
                },
              }
              : {}),
          });
          if (!published) {
            logger.debug("Skipped cache publication from stale transform leader", {
              file: logPath(filePath),
            });
          }
          // A revoked leader must not update shared caches, but its immutable
          // output is still valid for requests that joined this singleflight.
          return entry;
        };

        let entry: ModuleCacheEntry;
        if (this.options.dev) {
          // Dev cold starts overlap compilation with dependency traversal. The
          // first capacity slot ends with compilation, before the helper waits
          // for children, and post-processing reacquires a slot separately.
          const compileController = new AbortController();
          const compileSignal = composeAbortSignals([
            sharedSignal,
            compileController.signal,
          ]);
          const prepared = await runTransformAndDependencies(
            () =>
              this.withTransformCapacity(
                filePath,
                "build",
                () => compile(compileSignal),
                compileSignal,
              ),
            resolveDependencies,
            (dependencyError, transformSettlement) => {
              retainInProgressTransformUntilSettled(
                inProgressKey,
                transformPromise,
                transformSettlement,
                dependencyError,
              );
              compileController.abort(dependencyError);
            },
          );
          entry = await this.withTransformCapacity(
            filePath,
            "build",
            () => finishTransform(prepared.transformed, prepared.dependencies),
            sharedSignal,
          );
        } else {
          // Preserve production ordering and its single capacity window.
          const dependencies = await resolveDependencies();
          entry = await this.withTransformCapacity(
            filePath,
            "build",
            async () => await finishTransform(await compile(sharedSignal), dependencies),
            sharedSignal,
          );
        }

        markInProgressTransformSettled(transformPromise);
        resolveTransform(entry);
      } catch (error) {
        markInProgressTransformSettled(transformPromise);
        rejectTransform(error instanceof Error ? error : new Error(String(error)));
      } finally {
        clearTimeout(staleEvictionTimer);
        deleteInProgressTransformIfCurrent(inProgressKey, transformPromise);
      }
    };

    void runTransformLeader();
    return await leaderWait;
  }
}
