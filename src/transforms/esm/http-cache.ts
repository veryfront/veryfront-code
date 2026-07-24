/**
 * HTTP module cache for SSR.
 *
 * Fetches HTTP(S) modules (esm.sh, deno.land, etc.), rewrites their imports to
 * local file:// paths, and caches them on disk for runtime-agnostic loading.
 *
 * @module transforms/esm/http-cache
 */

import { createFileSystem, exists } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { BUILD_FAILED, BUNDLE_ERROR, FILE_NOT_FOUND, retryWithBackoff } from "#veryfront/errors";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";
import { replaceSpecifiers } from "./lexer.ts";
import { createBundleManifest, storeBundleManifest } from "./bundle-manifest.ts";
import { HTTP_MODULE_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";
import { httpBundleCache } from "./http-cache-wrapper.ts";
import { unbrand } from "./http-cache-types.ts";
import { asLocalModuleCode, VeryfrontError } from "./http-cache-invariants.ts";
import {
  CACHE_DIR_TOKEN,
  detokenizeAllCachePaths,
  detokenizeCachePaths,
  tokenizeAllCachePaths,
  tokenizeCachePaths,
} from "#veryfront/cache/paths.ts";
import { looksLikeHtmlContent as looksLikeHtmlNotJs } from "./html-content.ts";

// Extracted modules
import { embedSourceUrl, extractSourceUrl } from "./source-url-embed.ts";
import { isDegradedArtifact, markDegradedArtifact } from "./degraded-artifact.ts";
import {
  buildHttpCacheIdentity,
  buildHttpCacheIdentityMetadata,
  type CacheOptions,
  ensureAbsoluteDir,
  ensurePreparedHttpCacheRequestOptions,
  getEffectiveHttpCacheRequest,
  hashHttpCacheIdentity,
  hasIncompatibleFilePaths,
  type HttpCacheIdentityOptions,
  type HttpCacheLike,
  isHttpUrl,
  normalizeHttpUrl,
  prepareHttpCacheRequestOptions,
  type SetLike,
} from "./http-cache-helpers.ts";
import { extractBundleDeps, validateBundleDepsExist } from "./bundle-deps-validator.ts";
import {
  __clearInFlightHttpFetches,
  bundleAccumulatorStorage,
  inFlightHttpFetches,
  processingStackStorage,
  refreshDistributedCacheAsync,
  trackBundleAccumulator,
  waitForInFlightFetch,
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
const HTTP_MODULE_FETCH_MAX_ATTEMPTS = 3;
const HTTP_MODULE_FETCH_RETRY_DELAY_MS = 100;
const HTTP_MODULE_FETCH_WAIT_GRACE_MS = 5_000;
const HTTP_MODULE_FETCH_MAX_WAIT_MS = HTTP_FETCH_TIMEOUT_MS * HTTP_MODULE_FETCH_MAX_ATTEMPTS +
  HTTP_MODULE_FETCH_RETRY_DELAY_MS *
    ((HTTP_MODULE_FETCH_MAX_ATTEMPTS - 1) * HTTP_MODULE_FETCH_MAX_ATTEMPTS / 2) +
  HTTP_MODULE_FETCH_WAIT_GRACE_MS;

const httpCacheLog = logger.component("http-cache");
const contentMetricsLog = logger.component("content-metrics");

interface HttpModuleFetchResult {
  code: string;
  contentType: string;
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

  try {
    const startedAt = performance.now();
    response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
      signal,
      redirect: "follow",
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
      code: await response.text(),
      contentType: response.headers.get("content-type") ?? "",
    };
  } catch (error) {
    if (error instanceof HttpModuleResponseError) throw error;
    if (response) await discardResponseBody(response);

    const requestErrorType = error instanceof Error ? error.name : typeof error;
    throw new HttpModuleRequestError(requestErrorType);
  }
}

async function fetchHttpModule(url: string): Promise<HttpModuleFetchResult> {
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
        timeoutMs: HTTP_FETCH_TIMEOUT_MS,
        shouldRetry: (error) =>
          !(error instanceof HttpModuleResponseError) ||
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
      throw BUILD_FAILED.create({ detail: `Failed to fetch ${safeUrl}: ${error.status}` });
    }
    if (error instanceof HttpModuleRequestError) {
      throw BUILD_FAILED.create({
        detail: `Failed to fetch ${safeUrl}: ${error.requestErrorType}`,
      });
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
  const normalizedUrl = normalizeHttpUrl(url);
  const cacheDir = ensureAbsoluteDir(options.cacheDir);
  const cacheIdentity = await buildHttpCacheIdentity(normalizedUrl, options);
  const identityMetadata = await buildHttpCacheIdentityMetadata(normalizedUrl, options);
  const cacheKey = `${cacheDir}:${cacheIdentity}`;

  const existing = getCachedPaths().get(cacheKey);
  if (existing) {
    if (await exists(existing)) return existing;
    getCachedPaths().delete(cacheKey);
  }

  const hash = await hashHttpCacheIdentity(cacheIdentity);
  const cachePath = join(cacheDir, `http-${hash}.mjs`);
  const fs = createFileSystem();

  if (await exists(cachePath)) {
    const code = await fs.readTextFile(cachePath);

    if (isDegradedArtifact(code)) {
      // The artifact on disk is the fallback a previous render wrote when a
      // dependency could not be prefetched. Retry the prefetch instead of
      // handing the degradation on.
      httpCacheLog.debug("Local cache holds a degraded artifact, will re-fetch", {
        url: normalizedUrl,
        hash,
      });
    } else {
      const deps = extractBundleDeps(code);

      if (deps.length > 0) {
        const depsValid = await validateBundleDepsExist(deps, cacheDir);
        if (!depsValid) {
          httpCacheLog.debug("Local cache has missing deps, will re-fetch", {
            url: normalizedUrl,
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
          trackBundleAccumulator(hash, normalizedUrl, cachePath);
          return cachePath;
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
        trackBundleAccumulator(hash, normalizedUrl, cachePath);
        return cachePath;
      }
    }
  }

  const processingStack = getProcessingStack();
  if (processingStack.has(cacheIdentity)) {
    if (await exists(cachePath)) {
      httpCacheLog.debug("Circular dependency detected, file exists", {
        url: normalizedUrl,
      });
    } else {
      httpCacheLog.debug("Circular dependency detected, file pending write", {
        url: normalizedUrl,
        cachePath,
      });
    }
    return cachePath;
  }

  let inFlight = inFlightHttpFetches.get(cacheKey);
  while (inFlight) {
    const result = await waitForInFlightFetch(inFlight, cacheKey, HTTP_MODULE_FETCH_MAX_WAIT_MS);
    if (result !== undefined) return result;

    if (inFlightHttpFetches.get(cacheKey) === inFlight) {
      inFlightHttpFetches.delete(cacheKey);
      break;
    }
    inFlight = inFlightHttpFetches.get(cacheKey);
  }

  const fetchPromise = (async () => {
    const cacheResult = await httpBundleCache.getCodeByUrl(String(hash));

    if (cacheResult.code) {
      const cachedCode = unbrand(cacheResult.code);
      const deps = extractBundleDeps(cachedCode);

      if (deps.length > 0) {
        const depsExist = await validateBundleDepsExist(deps, cacheDir);
        if (!depsExist) {
          httpCacheLog.debug("Cached code has missing bundle deps, will re-fetch", {
            url: normalizedUrl,
            hash,
            missingDeps: deps.length,
          });
        } else {
          logger.debug(
            cacheResult.wasGzipped
              ? "[HTTP-CACHE] Distributed cache hit (gzip decoded)"
              : "[HTTP-CACHE] Distributed cache hit",
            { url: normalizedUrl, hash },
          );
          await fs.mkdir(cacheDir, { recursive: true });
          await fs.writeTextFile(cachePath, cachedCode);

          if (!(await exists(cachePath))) {
            throw FILE_NOT_FOUND.create({
              detail:
                `[HTTP-CACHE] INVARIANT VIOLATION: Redis recovery write succeeded but file does not exist: ${cachePath}`,
            });
          }

          getCachedPaths().set(cacheKey, cachePath);
          return cachePath;
        }
      } else {
        logger.debug(
          cacheResult.wasGzipped
            ? "[HTTP-CACHE] Distributed cache hit (gzip decoded, no deps)"
            : "[HTTP-CACHE] Distributed cache hit",
          { url: normalizedUrl, hash },
        );
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeTextFile(cachePath, cachedCode);

        if (!(await exists(cachePath))) {
          throw FILE_NOT_FOUND.create({
            detail:
              `[HTTP-CACHE] INVARIANT VIOLATION: Redis recovery write succeeded but file does not exist: ${cachePath}`,
          });
        }

        getCachedPaths().set(cacheKey, cachePath);
        return cachePath;
      }
    } else if (cacheResult.failReason && cacheResult.failReason !== "not_found") {
      httpCacheLog.debug("Distributed cache get failed", {
        url: normalizedUrl,
        reason: cacheResult.failReason,
      });
    }

    httpCacheLog.debug("Fetching from network", { url: normalizedUrl });
    const fetchedModule = await fetchHttpModule(normalizedUrl);
    let code = fetchedModule.code;

    const contentType = fetchedModule.contentType;
    const isHtmlContent = contentType.includes("text/html") || looksLikeHtmlNotJs(code);

    if (isHtmlContent) {
      logger.error(
        "[HTTP-CACHE] Received HTML instead of JavaScript, likely an esm.sh error page",
        {
          url: normalizedUrl,
          contentType,
          preview: code.slice(0, 200),
        },
      );
      throw BUNDLE_ERROR.create({
        detail:
          `Received HTML instead of JavaScript from ${normalizedUrl}. The package may not exist or failed to build on esm.sh.`,
      });
    }

    processingStack.add(cacheIdentity);
    let degraded: readonly string[] = [];
    try {
      const rewritten = await rewriteModuleImports(
        code,
        normalizedUrl,
        options,
        cacheHttpModule,
      );
      code = rewritten.code;
      degraded = rewritten.degraded;
    } finally {
      processingStack.delete(cacheIdentity);
    }

    code = embedSourceUrl(code, normalizedUrl);
    if (degraded.length > 0) code = markDegradedArtifact(code);

    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeTextFile(cachePath, code);

    if (!(await exists(cachePath))) {
      throw FILE_NOT_FOUND.create({
        detail:
          `[HTTP-CACHE] INVARIANT VIOLATION: File write succeeded but file does not exist: ${cachePath}`,
      });
    }

    if (degraded.length > 0) {
      // The file on disk carries this render through, but the artifact is not
      // the one this URL is supposed to produce. Keeping it out of the
      // distributed cache and the in-memory path map means the next render
      // retries the prefetch instead of inheriting one upstream blip for the
      // lifetime of the distributed entry.
      httpCacheLog.warn("Not caching a module with unresolved dynamic imports", {
        url: normalizedUrl,
        hash,
        degraded,
      });
      return cachePath;
    }

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
      httpCacheLog.debug("Distributed cache set failed", { url: normalizedUrl, error });
    }

    getCachedPaths().set(cacheKey, cachePath);

    const accumulator = bundleAccumulatorStorage.getStore();
    if (accumulator) {
      accumulator.push({
        hash: String(hash),
        url: normalizedUrl,
        sizeBytes: code.length,
      });
    }

    return cachePath;
  })();

  inFlightHttpFetches.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightHttpFetches.delete(cacheKey);
  }
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
  const requestOptions = prepareHttpCacheRequestOptions(options);
  return bundleAccumulatorStorage.run([], async () => {
    const { replacements } = await buildReplacements(
      code,
      undefined,
      requestOptions,
      cacheHttpModule,
    );
    if (replacements.size === 0) return { code };

    httpCacheLog.debug("Cached HTTP imports", { count: replacements.size });

    const rewrittenCode = await replaceSpecifiers(
      code,
      (specifier) => replacements.get(specifier) ?? null,
    );

    const bundles = bundleAccumulatorStorage.getStore();
    if (!bundles?.length) return { code: rewrittenCode };

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
