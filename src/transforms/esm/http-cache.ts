/**
 * HTTP module cache for SSR.
 *
 * Fetches HTTP(S) modules (esm.sh, deno.land, etc.), rewrites their imports to
 * local file:// paths, and caches them on disk for runtime-agnostic loading.
 *
 * @module transforms/esm/http-cache
 */

import { createFileSystem, exists, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { BUILD_FAILED, BUNDLE_ERROR, retryWithBackoff } from "#veryfront/errors";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";
import { replaceSpecifiers } from "./lexer.ts";
import { createBundleManifest, storeBundleManifest } from "./bundle-manifest.ts";
import { HTTP_MODULE_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import {
  HTTP_MODULE_FETCH_MAX_ATTEMPTS,
  HTTP_MODULE_FETCH_RETRY_BUDGET_MS,
  HTTP_MODULE_FETCH_RETRY_DELAY_MS,
  HTTP_MODULE_FETCH_TIMEOUT_MS,
} from "#veryfront/utils/constants/http.ts";
import { httpBundleCache } from "./http-cache-wrapper.ts";
import { unbrand } from "./http-cache-types.ts";
import { asLocalModuleCode, VeryfrontError } from "./http-cache-invariants.ts";
import {
  CACHE_DIR_TOKEN,
  CACHE_INVARIANT_VIOLATION,
  detokenizeAllCachePaths,
  detokenizeCachePaths,
  tokenizeAllCachePaths,
  tokenizeCachePaths,
} from "#veryfront/cache/paths.ts";
import { looksLikeHtmlContent as looksLikeHtmlNotJs } from "./html-content.ts";
import { HttpModuleBodyError, readHttpModuleText } from "../shared/http-module-response.ts";
import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import type { TransformProgressListener } from "#veryfront/transforms/progress.ts";
import {
  guardedOutboundFetch,
  OutboundRequestBlockedError,
} from "#veryfront/security/http/outbound-fetch.ts";

// Extracted modules
import { embedSourceUrl, extractSourceUrl } from "./source-url-embed.ts";
import { isDegradedArtifact } from "./degraded-artifact.ts";
import {
  buildHttpCacheIdentity,
  buildHttpCacheIdentityMetadata,
  type CacheOptions,
  deriveHttpCacheRequestOptions,
  describeHtmlModuleResponse,
  ensureAbsoluteDir,
  ensurePreparedHttpCacheRequestOptions,
  fingerprintHttpModuleRequest,
  getEffectiveHttpCacheRequest,
  hashHttpCacheIdentity,
  hasIncompatibleFilePaths,
  type HttpCacheIdentityOptions,
  type HttpCacheLike,
  isHttpUrl,
  normalizeHttpUrl,
  prepareHttpCacheRequestOptions,
  sanitizeHttpModuleRedirectDestination,
  type SetLike,
} from "./http-cache-helpers.ts";
import { extractBundleDeps, validateBundleDepsExist } from "./bundle-deps-validator.ts";
import {
  type BundleAccumulator,
  bundleAccumulatorStorage,
  createBundleAccumulator,
  trackCachedBundleGraph,
  trackWrittenBundle,
} from "./bundle-accumulator.ts";
import { ModuleSourceCapture } from "./module-source-capture.ts";
import type { RenderArtifactLimits } from "./render-artifacts.ts";
import type { RenderModuleSnapshot } from "./link-render-modules.ts";
import {
  isHttpBundleCodeWithinLimit,
  MAX_CACHED_HTTP_BUNDLE_BYTES,
  readCachedHttpBundleFile,
} from "./http-bundle-file.ts";
import {
  __clearInFlightHttpFetches,
  createInFlightHttpFetch,
  hasInFlightHttpFetchOwner,
  IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE,
  type InFlightHttpFetchControl,
  inFlightHttpFetches,
  processingStackStorage,
  refreshDistributedCacheAsync,
  waitForInFlightFetch,
  waitForSharedInFlightHttpFetch,
} from "./in-flight-manager.ts";
import {
  __injectCachesForTests,
  getCachedPaths,
  getLastDistributedRefresh,
  getProcessingStack,
  hasInjectedProcessingStack,
} from "./http-cache-state.ts";
import { buildReplacements, rewriteModuleImports } from "./specifier-resolver.ts";
import {
  ensureHttpBundlesExist as ensureHttpBundlesExistImpl,
  invalidateHttpBundle as invalidateHttpBundleImpl,
  recoverHttpBundleByHash as recoverHttpBundleByHashImpl,
} from "./bundle-recovery.ts";

/** Threshold in ms above which an HTTP module fetch is considered slow */
const SLOW_HTTP_FETCH_THRESHOLD_MS = 500;
const HTTP_MODULE_FETCH_WAIT_GRACE_MS = 5_000;
const HTTP_MODULE_PUBLICATION_TIMEOUT_MS = HTTP_MODULE_FETCH_TIMEOUT_MS +
  HTTP_MODULE_FETCH_WAIT_GRACE_MS;
/** Maximum time a caller can wait for one complete HTTP module fetch sequence. */
export const HTTP_MODULE_FETCH_MAX_WAIT_MS = HTTP_MODULE_FETCH_RETRY_BUDGET_MS +
  HTTP_MODULE_FETCH_WAIT_GRACE_MS;

const httpCacheLog = logger.component("http-cache");
const contentMetricsLog = logger.component("content-metrics");
const httpBundlePublications = new Map<string, Promise<unknown>>();
type HttpModuleCacheDirResolver = (url: string, requestedCacheDir: string) => string | undefined;
let testHttpModuleCacheDirResolver: HttpModuleCacheDirResolver | undefined;

/** Install a URL-aware HTTP module cache override in a DENO_TESTING process. */
export function __setHttpModuleCacheDirResolverForTests(
  resolver: HttpModuleCacheDirResolver | undefined,
): () => void {
  if (getHostEnv("DENO_TESTING") !== "1") {
    throw new Error("The HTTP module cache test override requires DENO_TESTING=1");
  }
  const previous = testHttpModuleCacheDirResolver;
  testHttpModuleCacheDirResolver = resolver;
  return () => {
    if (testHttpModuleCacheDirResolver === resolver) testHttpModuleCacheDirResolver = previous;
  };
}

function abandonedHttpFetchError(abortSignal: AbortSignal): unknown {
  return abortSignal.reason ??
    new DOMException("The HTTP module fetch was replaced", "AbortError");
}

function assertCurrentHttpFetch(
  abortSignal: AbortSignal,
  control: InFlightHttpFetchControl,
): void {
  abortSignal.throwIfAborted();
  if (!control.isCurrent()) throw abandonedHttpFetchError(abortSignal);
}

async function publishHttpBundleGeneration<T>(
  cacheKey: string,
  cachePath: string,
  code: string,
  fs: FileSystem,
  abortSignal: AbortSignal,
  control: InFlightHttpFetchControl,
  prepare: () => Promise<void>,
  publish: () => Promise<T>,
): Promise<T> {
  const stagedPath = `${cachePath}.pending-${crypto.randomUUID()}`;
  try {
    await fs.writeTextFile(stagedPath, code);

    const previousPublication = httpBundlePublications.get(cacheKey) ?? Promise.resolve();
    const publication: Promise<T> = previousPublication
      .catch(() => {})
      .then(async () => {
        assertCurrentHttpFetch(abortSignal, control);
        if (!control.commit(HTTP_MODULE_PUBLICATION_TIMEOUT_MS)) {
          throw abandonedHttpFetchError(abortSignal);
        }
        // The committed publication stays authoritative even if its caller-facing
        // deadline expires. Storage writes already in progress must finish before
        // another generation can safely publish this cache key.
        await prepare();
        if (!fs.rename) {
          throw new Error("The active filesystem does not support atomic bundle publication");
        }
        await fs.rename(stagedPath, cachePath);
        return await publish();
      })
      .finally(() => {
        if (httpBundlePublications.get(cacheKey) === publication) {
          httpBundlePublications.delete(cacheKey);
        }
      });
    httpBundlePublications.set(cacheKey, publication);

    return await publication;
  } finally {
    try {
      if (await fs.exists(stagedPath)) await fs.remove(stagedPath);
    } catch (error) {
      httpCacheLog.debug("Failed to remove staged HTTP bundle", { error });
    }
  }
}

interface HttpModuleFetchResult {
  code: string;
  contentType: string;
  redirect?: { status: number; url: string; isAuthentication: boolean };
}

function terminalHttpModuleFetchError(
  detail: string,
  context: {
    httpStatus?: number;
    httpModuleUrl?: string;
    httpModuleRequestFingerprint?: string;
  } = {},
): VeryfrontError {
  return BUILD_FAILED.create({
    detail,
    context: { phase: "http-module-fetch", ...context },
  });
}

class HttpModuleResponseError extends Error {
  constructor(readonly status: number) {
    super(`HTTP module response returned status ${status}`);
    this.name = "HttpModuleResponseError";
  }
}

class HttpModuleRequestError extends Error {
  constructor(readonly requestErrorType: string) {
    super(`HTTP module request failed (${requestErrorType})`);
    this.name = "HttpModuleRequestError";
  }
}

function shouldRetryHttpModuleFetch(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch (_) {
    // The response is already being discarded.
  }
}

async function fetchHttpModuleAttempt(
  url: string,
  safeUrl: string,
  urlObj: URL,
  signal: AbortSignal | undefined,
  attempt: number,
): Promise<HttpModuleFetchResult> {
  let response: Response | undefined;
  let redirect: HttpModuleFetchResult["redirect"];

  try {
    const startedAt = performance.now();
    response = await guardedOutboundFetch(url, {
      headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
      signal,
      redirect: "follow",
    }, {
      onRedirect(hop) {
        const destination = sanitizeHttpModuleRedirectDestination(hop.toUrl.href);
        redirect = {
          status: hop.status,
          ...destination,
        };
      },
    });

    const duration = Math.round(performance.now() - startedAt);
    contentMetricsLog.debug("HTTP_MODULE_FETCH", {
      url: safeUrl,
      host: urlObj.host,
      duration_ms: duration,
      status: response.status,
      slow: duration > SLOW_HTTP_FETCH_THRESHOLD_MS,
      attempt: attempt + 1,
    });

    if (!response.ok) {
      const status = response.status;
      await discardResponseBody(response);
      throw new HttpModuleResponseError(status);
    }

    return {
      code: await readHttpModuleText(
        response,
        MAX_BUNDLE_CHUNK_SIZE_BYTES,
        signal,
      ),
      contentType: response.headers.get("content-type") ?? "",
      redirect,
    };
  } catch (error) {
    if (
      error instanceof HttpModuleResponseError || error instanceof HttpModuleBodyError ||
      error instanceof OutboundRequestBlockedError
    ) {
      throw error;
    }
    if (response) await discardResponseBody(response);

    const requestErrorType = error instanceof Error ? error.name : typeof error;
    throw new HttpModuleRequestError(requestErrorType);
  }
}

async function fetchHttpModule(
  url: string,
  abortSignal?: AbortSignal,
): Promise<HttpModuleFetchResult> {
  const urlObj = new URL(url);
  const safeUrl = sanitizeUrlForSpan(url);

  try {
    return await retryWithBackoff(
      (signal, attempt) =>
        withSpan(
          SpanNames.HTTP_CLIENT_FETCH,
          () => fetchHttpModuleAttempt(url, safeUrl, urlObj, signal, attempt),
          {
            "http.method": "GET",
            "http.url": safeUrl,
            "http.host": urlObj.host,
            "http.scheme": urlObj.protocol.replace(":", ""),
            "esm.package_fetch": true,
          },
        ),
      {
        maxAttempts: HTTP_MODULE_FETCH_MAX_ATTEMPTS,
        abortSignal,
        timeoutMs: HTTP_MODULE_FETCH_TIMEOUT_MS,
        shouldRetry: (error) =>
          error instanceof HttpModuleBodyError
            ? false
            : error instanceof OutboundRequestBlockedError
            ? false
            : !(error instanceof HttpModuleResponseError) ||
              shouldRetryHttpModuleFetch(error.status),
        computeDelay: (attempt) => HTTP_MODULE_FETCH_RETRY_DELAY_MS * (attempt + 1),
        onRetry: ({ error, attempt }) => {
          httpCacheLog.warn("HTTP module fetch failed, retrying", {
            url: safeUrl,
            status: error instanceof HttpModuleResponseError ? error.status : undefined,
            errorType: error instanceof HttpModuleRequestError
              ? error.requestErrorType
              : error.name,
            attempt: attempt + 1,
          });
        },
      },
    );
  } catch (error) {
    if (error instanceof HttpModuleResponseError) {
      throw terminalHttpModuleFetchError(
        `Failed to fetch ${safeUrl}: ${error.status}`,
        {
          httpStatus: error.status,
          httpModuleUrl: safeUrl,
          httpModuleRequestFingerprint: await fingerprintHttpModuleRequest(url),
        },
      );
    }
    if (error instanceof HttpModuleRequestError) {
      throw terminalHttpModuleFetchError(
        `Failed to fetch ${safeUrl}: ${error.requestErrorType}`,
      );
    }
    if (error instanceof HttpModuleBodyError) {
      throw terminalHttpModuleFetchError(`Failed to fetch ${safeUrl}: ${error.message}`);
    }
    if (error instanceof OutboundRequestBlockedError) {
      // Preserve the policy-denial type so downstream specifier resolution can
      // distinguish it from a transient fetch failure. Dynamic imports must
      // never degrade into an unguarded runtime fetch after a policy denial.
      throw error;
    }
    throw error;
  }
}

// Re-export for backwards compatibility
export {
  CACHE_DIR_TOKEN,
  detokenizeAllCachePaths,
  detokenizeCachePaths,
  tokenizeAllCachePaths,
  tokenizeCachePaths,
};

// Re-export extracted types/functions used by consumers
export type { CacheOptions, HttpCacheLike, SetLike };
export { extractBundleDeps, hasIncompatibleFilePaths, normalizeHttpUrl };
export { __clearInFlightHttpFetches };
export { embedSourceUrl, extractSourceUrl };
export { __injectCachesForTests };

async function cacheHttpModuleInternal(url: string, options: CacheOptions): Promise<string | null> {
  options.abortSignal?.throwIfAborted();
  const normalizedUrl = normalizeHttpUrl(url);
  const safeUrl = sanitizeUrlForSpan(normalizedUrl);
  const cacheDir = ensureAbsoluteDir(
    testHttpModuleCacheDirResolver?.(normalizedUrl, options.cacheDir) ?? options.cacheDir,
  );
  const cacheIdentity = await buildHttpCacheIdentity(normalizedUrl, options);
  const identityMetadata = await buildHttpCacheIdentityMetadata(normalizedUrl, options);
  const cacheKey = `${cacheDir}:${cacheIdentity}`;
  const hash = await hashHttpCacheIdentity(cacheIdentity);
  const cachePath = join(cacheDir, `http-${hash}.mjs`);
  const fs = createFileSystem();
  const committedPublication = httpBundlePublications.get(cacheKey);
  if (committedPublication && !inFlightHttpFetches.has(cacheKey)) {
    // A committed generation outlived its caller-facing flight. Quarantine the
    // key until that publication settles instead of starting a competing write.
    const settled = await waitForInFlightFetch(
      committedPublication.then(() => null, () => null),
      HTTP_MODULE_FETCH_MAX_WAIT_MS,
      options.abortSignal,
    );
    if (settled === undefined) return null;
  }
  const publicationPending = httpBundlePublications.has(cacheKey) ||
    inFlightHttpFetches.has(cacheKey);

  const existing = publicationPending ? undefined : getCachedPaths().get(cacheKey);
  if (existing) {
    if (
      await exists(existing) &&
      await trackCachedBundleGraph(hash, normalizedUrl, existing, cacheDir)
    ) {
      return existing;
    }
    getCachedPaths().delete(cacheKey);
  }

  if (!publicationPending && await exists(cachePath)) {
    const cachedBundle = await readCachedHttpBundleFile(fs, cachePath);
    const code = cachedBundle?.code;

    if (!code) {
      httpCacheLog.debug("Local cache bundle is unreadable or oversized, will re-fetch", {
        url: safeUrl,
        hash,
      });
    } else if (isDegradedArtifact(code)) {
      // The artifact on disk is the fallback a previous render wrote when a
      // dependency could not be prefetched. Retry the prefetch instead of
      // handing the degradation on.
      httpCacheLog.debug("Local cache holds a degraded artifact, will re-fetch", {
        url: safeUrl,
        hash,
      });
    } else {
      const deps = extractBundleDeps(code);

      if (deps.length > 0) {
        const depsValid = await validateBundleDepsExist(deps, cacheDir);
        if (!depsValid) {
          httpCacheLog.debug("Local cache has missing deps, will re-fetch", {
            url: safeUrl,
            hash,
            missingDeps: deps.length,
          });
        } else {
          getCachedPaths().set(cacheKey, cachePath);
          refreshDistributedCacheAsync(
            hash,
            code,
            cacheDir,
            normalizedUrl,
            identityMetadata,
            getLastDistributedRefresh,
          );
          if (await trackCachedBundleGraph(hash, normalizedUrl, cachePath, cacheDir)) {
            return cachePath;
          }
        }
      } else {
        getCachedPaths().set(cacheKey, cachePath);
        refreshDistributedCacheAsync(
          hash,
          code,
          cacheDir,
          normalizedUrl,
          identityMetadata,
          getLastDistributedRefresh,
        );
        if (await trackCachedBundleGraph(hash, normalizedUrl, cachePath, cacheDir)) {
          return cachePath;
        }
      }
    }
  }

  const processingStack = getProcessingStack();
  if (processingStack.has(cacheIdentity)) {
    if (await exists(cachePath)) {
      httpCacheLog.debug("Circular dependency detected, file exists", {
        url: safeUrl,
      });
    } else {
      httpCacheLog.debug("Circular dependency detected, file pending write", {
        url: safeUrl,
        cachePath,
      });
    }
    return cachePath;
  }

  let inFlight = inFlightHttpFetches.get(cacheKey);
  while (inFlight) {
    const result = await waitForSharedInFlightHttpFetch(
      cacheKey,
      inFlight,
      HTTP_MODULE_FETCH_MAX_WAIT_MS,
      options.abortSignal,
      options.onProgress,
    );
    if (result === IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE) {
      httpCacheLog.debug("Cross-flight circular dependency detected, file pending write", {
        url: safeUrl,
      });
      return cachePath;
    }
    if (result === undefined && options.abortSignal === undefined) {
      return null;
    }
    if (result !== undefined) {
      if (
        result === null ||
        await trackCachedBundleGraph(hash, normalizedUrl, result, cacheDir)
      ) {
        return result;
      }
    }

    inFlight = inFlightHttpFetches.get(cacheKey);
  }

  const computeHttpBundle = async (
    abortSignal: AbortSignal,
    reportProgress: TransformProgressListener,
    control: InFlightHttpFetchControl,
  ): Promise<string | null> => {
    const sharedOptions = deriveHttpCacheRequestOptions(options, {
      abortSignal,
      onProgress: reportProgress,
    });
    const cacheResult = publicationPending
      ? { code: null, wasGzipped: false, failReason: "not_found" as const }
      : await httpBundleCache.getCodeByUrl(String(hash));
    abortSignal.throwIfAborted();
    reportProgress({
      phase: "http-cache:cache-lookup-complete",
      filePath: `http-${hash}.mjs`,
    });

    if (cacheResult.code) {
      const cachedCode = unbrand(cacheResult.code);
      const deps = extractBundleDeps(cachedCode);
      const isUsable = !isDegradedArtifact(cachedCode) &&
        isHttpBundleCodeWithinLimit(cachedCode) &&
        (deps.length === 0 || await validateBundleDepsExist(deps, cacheDir));

      if (!isUsable) {
        httpCacheLog.debug("Distributed cache bundle is incomplete or oversized, will re-fetch", {
          url: safeUrl,
          hash,
          dependencyCount: deps.length,
        });
      } else {
        logger.debug(
          cacheResult.wasGzipped
            ? "[HTTP-CACHE] Distributed cache hit (gzip decoded)"
            : "[HTTP-CACHE] Distributed cache hit",
          { url: safeUrl, hash },
        );
        abortSignal.throwIfAborted();
        await fs.mkdir(cacheDir, { recursive: true });
        abortSignal.throwIfAborted();
        const recovered = await publishHttpBundleGeneration(
          cacheKey,
          cachePath,
          cachedCode,
          fs,
          abortSignal,
          control,
          () => Promise.resolve(),
          async () => {
            if (!(await exists(cachePath))) {
              throw CACHE_INVARIANT_VIOLATION.create({
                detail:
                  `[HTTP-CACHE] INVARIANT VIOLATION: Redis recovery write succeeded but file does not exist: ${cachePath}`,
              });
            }
            getCachedPaths().set(cacheKey, cachePath);
            return await trackCachedBundleGraph(hash, normalizedUrl, cachePath, cacheDir);
          },
        );
        if (recovered) {
          return cachePath;
        }
        getCachedPaths().delete(cacheKey);
      }
    } else if (cacheResult.failReason && cacheResult.failReason !== "not_found") {
      httpCacheLog.debug("Distributed cache get failed", {
        url: safeUrl,
        reason: cacheResult.failReason,
      });
    }

    httpCacheLog.debug("Fetching from network", { url: safeUrl });
    const fetchedModule = await fetchHttpModule(normalizedUrl, abortSignal);
    abortSignal.throwIfAborted();
    let code = fetchedModule.code;

    const contentType = fetchedModule.contentType;
    const isHtmlContent = contentType.includes("text/html") || looksLikeHtmlNotJs(code);

    if (isHtmlContent) {
      logger.error(
        "[HTTP-CACHE] Received HTML instead of JavaScript",
        {
          url: safeUrl,
          contentType,
          redirectStatus: fetchedModule.redirect?.status,
          redirectUrl: fetchedModule.redirect?.url,
        },
      );
      throw BUNDLE_ERROR.create({
        detail: describeHtmlModuleResponse(safeUrl, fetchedModule.redirect),
      });
    }

    reportProgress({
      phase: "http-cache:module-fetched",
      filePath: `http-${hash}.mjs`,
    });

    processingStack.add(cacheIdentity);
    try {
      const rewritten = await rewriteModuleImports(
        code,
        normalizedUrl,
        sharedOptions,
        cacheHttpModule,
      );
      code = rewritten.code;
    } finally {
      processingStack.delete(cacheIdentity);
    }

    abortSignal.throwIfAborted();
    code = embedSourceUrl(code, normalizedUrl);
    if (!isHttpBundleCodeWithinLimit(code)) {
      throw BUNDLE_ERROR.create({
        detail: `Rewritten HTTP module exceeds ${MAX_CACHED_HTTP_BUNDLE_BYTES} bytes`,
      });
    }

    await fs.mkdir(cacheDir, { recursive: true });
    abortSignal.throwIfAborted();
    return await publishHttpBundleGeneration(
      cacheKey,
      cachePath,
      code,
      fs,
      abortSignal,
      control,
      async () => {
        try {
          await httpBundleCache.setCode(
            String(hash),
            asLocalModuleCode(code),
            normalizedUrl,
            HTTP_MODULE_DISTRIBUTED_TTL_SEC,
            identityMetadata,
          );
        } catch (error) {
          if (error instanceof VeryfrontError && error.slug === "cache-invariant-violation") {
            throw error;
          }
          httpCacheLog.debug("Distributed cache set failed", { url: safeUrl, error });
        }
      },
      async () => {
        if (!(await exists(cachePath))) {
          throw CACHE_INVARIANT_VIOLATION.create({
            detail:
              `[HTTP-CACHE] INVARIANT VIOLATION: File write succeeded but file does not exist: ${cachePath}`,
          });
        }

        getCachedPaths().set(cacheKey, cachePath);
        if (!(await trackWrittenBundle(hash, normalizedUrl, cachePath))) {
          getCachedPaths().delete(cacheKey);
          throw BUNDLE_ERROR.create({
            detail: "Freshly written HTTP bundle could not be verified",
          });
        }

        return cachePath;
      },
    );
  };
  const lateCommittedPublication = httpBundlePublications.get(cacheKey);
  if (lateCommittedPublication && !inFlightHttpFetches.has(cacheKey)) {
    const settled = await waitForInFlightFetch(
      lateCommittedPublication.then(() => null, () => null),
      HTTP_MODULE_FETCH_MAX_WAIT_MS,
      options.abortSignal,
    );
    if (settled === undefined) return null;
    return await cacheHttpModuleInternal(url, options);
  }
  const fetchPromise = createInFlightHttpFetch(cacheKey, computeHttpBundle);

  const result = await waitForSharedInFlightHttpFetch(
    cacheKey,
    fetchPromise,
    null,
    options.abortSignal,
    options.onProgress,
  );
  if (
    result &&
    !(await trackCachedBundleGraph(hash, normalizedUrl, result, cacheDir))
  ) {
    if (hasInFlightHttpFetchOwner()) return result;
    getCachedPaths().delete(cacheKey);
    throw BUNDLE_ERROR.create({
      detail: "Completed HTTP bundle graph could not be verified",
    });
  }
  return result;
}

async function cacheHttpModule(url: string, options: CacheOptions): Promise<string | null> {
  const preparedOptions = ensurePreparedHttpCacheRequestOptions(options);
  const effective = getEffectiveHttpCacheRequest(url, preparedOptions);
  const effectiveOptions = effective.options;

  if (hasInjectedProcessingStack() || processingStackStorage.getStore()) {
    return cacheHttpModuleInternal(effective.url, effectiveOptions);
  }

  return processingStackStorage.run(
    new Set(),
    () => cacheHttpModuleInternal(effective.url, effectiveOptions),
  );
}

/** Result of cacheHttpImportsToLocal including bundle manifest info. */
interface CacheHttpImportsResult {
  code: string;
  bundleManifestId?: string;
}

/**
 * Rewrite HTTP imports in the provided code to cached local file:// paths.
 * Returns the rewritten code and an optional bundle manifest ID for atomic validation.
 */
export function cacheHttpImportsToLocal(
  code: string,
  options: CacheOptions,
): Promise<CacheHttpImportsResult> {
  return cacheHttpImports(code, options, createBundleAccumulator());
}

/**
 * Capture HTTP dependency bytes while performing the normal cache rewrite.
 *
 * The explicit limits bound captured dependency count and UTF-8 URL/source
 * bytes, not the root code or heap usage. This retains only modules observed
 * by existing bundle validation, including cache hits. It does not follow
 * arbitrary file imports, close the entire MDX graph, or authorize execution.
 * Use the linker to verify graph closure after collecting the other sources.
 * Sources contain replica-local URLs and must not enter distributed caches.
 */
export async function captureHttpImportsToLocal(
  code: string,
  options: CacheOptions,
  limits: RenderArtifactLimits,
): Promise<CacheHttpImportsResult & { modules: RenderModuleSnapshot["modules"] }> {
  const abortSignal = options.abortSignal;
  const sourceCapture = new ModuleSourceCapture(limits);
  const accumulator = { ...createBundleAccumulator(), sourceCapture };
  try {
    const result = await cacheHttpImports(code, options, accumulator);
    abortSignal?.throwIfAborted();
    if (!accumulator.complete) {
      throw BUILD_FAILED.create({ detail: "HTTP module capture is incomplete" });
    }
    return { ...result, modules: sourceCapture.take() };
  } finally {
    sourceCapture.discard();
  }
}

function cacheHttpImports(
  code: string,
  options: CacheOptions,
  accumulator: BundleAccumulator,
): Promise<CacheHttpImportsResult> {
  options.abortSignal?.throwIfAborted();
  const requestOptions = prepareHttpCacheRequestOptions(options);
  return bundleAccumulatorStorage.run(accumulator, async () => {
    const { replacements } = await buildReplacements(
      code,
      undefined,
      requestOptions,
      cacheHttpModule,
    );
    requestOptions.abortSignal?.throwIfAborted();
    if (replacements.size === 0) return { code };

    httpCacheLog.debug("Cached HTTP imports", { count: replacements.size });

    const rewrittenCode = await replaceSpecifiers(
      code,
      (specifier) => replacements.get(specifier) ?? null,
    );

    const currentAccumulator = bundleAccumulatorStorage.getStore();
    if (!currentAccumulator?.complete || currentAccumulator.bundles.size === 0) {
      return { code: rewrittenCode };
    }
    const bundles = [...currentAccumulator.bundles.values()].sort((left, right) =>
      left.hash.localeCompare(right.hash)
    );

    try {
      const manifest = await createBundleManifest(bundles);
      await storeBundleManifest(manifest);
      httpCacheLog.debug("Created bundle manifest", {
        manifestId: manifest.manifestId.slice(0, 12),
        bundleCount: bundles.length,
      });
      return { code: rewrittenCode, bundleManifestId: manifest.manifestId };
    } catch (error) {
      httpCacheLog.debug("Failed to create bundle manifest", { error });
      return { code: rewrittenCode };
    }
  });
}

/**
 * Cache a specific HTTP module URL and return its local file:// path.
 */
export async function cacheModuleToLocal(
  url: string,
  cacheDir: string,
  reactVersion?: string,
): Promise<string> {
  if (!isHttpUrl(url)) return url;

  const importMap = { imports: {}, scopes: {} };
  const cached = await cacheHttpModule(url, { cacheDir, importMap, reactVersion });

  return cached ? `file://${cached}` : url;
}

/**
 * Recover a missing HTTP bundle by looking up the code directly from the hash.
 * Delegates to bundle-recovery module with cacheHttpModule wired in.
 */
export function recoverHttpBundleByHash(
  hash: string,
  cacheDir: string,
  parentCode?: string,
  identity?: HttpCacheIdentityOptions,
): Promise<boolean> {
  return recoverHttpBundleByHashImpl(hash, cacheDir, cacheHttpModule, parentCode, identity);
}

/**
 * Ensure all HTTP bundles exist locally before import.
 * Delegates to bundle-recovery module with cacheHttpModule wired in.
 */
export function ensureHttpBundlesExist(
  bundlePaths: Array<{ path: string; hash: string }>,
  cacheDir: string,
  identity?: HttpCacheIdentityOptions,
): Promise<string[]> {
  return ensureHttpBundlesExistImpl(bundlePaths, cacheDir, cacheHttpModule, identity);
}

/**
 * Invalidate a corrupted bundle from both local and distributed cache.
 */
export function invalidateHttpBundle(hash: string, cacheDir: string): Promise<boolean> {
  return invalidateHttpBundleImpl(hash, cacheDir);
}

// Test-only export for extractBundleDeps
export const __test_extractBundleDeps = extractBundleDeps;

// Export URL embedding functions for testing
const __test_embedSourceUrl = embedSourceUrl;
const __test_extractSourceUrl = extractSourceUrl;
