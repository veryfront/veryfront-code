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
import { BUILD_FAILED, BUNDLE_ERROR, FILE_NOT_FOUND } from "#veryfront/errors";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
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
import { readHttpModuleResponse } from "#veryfront/transforms/shared/http-module-response.ts";
import { writeCacheFile } from "#veryfront/utils/cache-file-ops.ts";
import { errorLogName } from "../shared/log-context.ts";

// Extracted modules
import { embedSourceUrl, extractSourceUrl } from "./source-url-embed.ts";
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
  clearInFlightHttpFetchIfOwned,
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

const httpCacheLog = logger.component("http-cache");
const contentMetricsLog = logger.component("content-metrics");

function httpLogContext(url: string): { scheme: string } {
  return { scheme: new URL(url).protocol.replace(":", "") };
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
  const hash = await hashHttpCacheIdentity(cacheIdentity);

  const existing = getCachedPaths().get(cacheKey);
  if (existing) {
    if (await exists(existing)) {
      await trackBundleAccumulator(hash, normalizedUrl, existing);
      return existing;
    }
    getCachedPaths().delete(cacheKey);
  }

  const cachePath = join(cacheDir, `http-${hash}.mjs`);
  const fs = createFileSystem();

  if (await exists(cachePath)) {
    const code = await fs.readTextFile(cachePath);
    const deps = extractBundleDeps(code);

    if (deps.length > 0) {
      const depsValid = await validateBundleDepsExist(deps, cacheDir);
      if (!depsValid) {
        httpCacheLog.debug("Local cache has missing deps, will re-fetch", {
          ...httpLogContext(normalizedUrl),
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
        await trackBundleAccumulator(hash, normalizedUrl, cachePath);
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
      await trackBundleAccumulator(hash, normalizedUrl, cachePath);
      return cachePath;
    }
  }

  const processingStack = getProcessingStack();
  if (processingStack.has(cacheIdentity)) {
    if (await exists(cachePath)) {
      httpCacheLog.debug("Circular dependency detected, file exists", {
        ...httpLogContext(normalizedUrl),
      });
    } else {
      httpCacheLog.debug("Circular dependency detected, file pending write", {
        ...httpLogContext(normalizedUrl),
      });
    }
    if (await exists(cachePath)) {
      await trackBundleAccumulator(hash, normalizedUrl, cachePath);
    }
    return cachePath;
  }

  let inFlight = inFlightHttpFetches.get(cacheKey);
  while (inFlight) {
    const result = await waitForInFlightFetch(inFlight, cacheKey);
    if (result !== undefined) {
      if (result !== null) await trackBundleAccumulator(hash, normalizedUrl, result);
      return result;
    }

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
            ...httpLogContext(normalizedUrl),
            hash,
            missingDeps: deps.length,
          });
        } else {
          logger.debug(
            cacheResult.wasGzipped
              ? "[HTTP-CACHE] Distributed cache hit (gzip decoded)"
              : "[HTTP-CACHE] Distributed cache hit",
            { ...httpLogContext(normalizedUrl), hash },
          );
          const written = await writeCacheFile(fs, cachePath, cachedCode, "HTTP-CACHE");
          if (!written) {
            throw FILE_NOT_FOUND.create({
              detail: "Recovered HTTP cache file was not created after a successful write.",
            });
          }

          getCachedPaths().set(cacheKey, cachePath);
          await trackBundleAccumulator(hash, normalizedUrl, cachePath);
          return cachePath;
        }
      } else {
        logger.debug(
          cacheResult.wasGzipped
            ? "[HTTP-CACHE] Distributed cache hit (gzip decoded, no deps)"
            : "[HTTP-CACHE] Distributed cache hit",
          { ...httpLogContext(normalizedUrl), hash },
        );
        const written = await writeCacheFile(fs, cachePath, cachedCode, "HTTP-CACHE");
        if (!written) {
          throw FILE_NOT_FOUND.create({
            detail: "Recovered HTTP cache file was not created after a successful write.",
          });
        }

        getCachedPaths().set(cacheKey, cachePath);
        await trackBundleAccumulator(hash, normalizedUrl, cachePath);
        return cachePath;
      }
    } else if (cacheResult.failReason && cacheResult.failReason !== "not_found") {
      httpCacheLog.debug("Distributed cache get failed", {
        ...httpLogContext(normalizedUrl),
        reason: cacheResult.failReason,
      });
    }

    httpCacheLog.debug("Fetching from network", httpLogContext(normalizedUrl));

    const urlObj = new URL(normalizedUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_FETCH_TIMEOUT_MS);

    const httpFetchStartTime = performance.now();

    let response: Response;
    let code: string;
    try {
      response = await withSpan(
        SpanNames.HTTP_CLIENT_FETCH,
        () =>
          fetch(normalizedUrl, {
            headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
            signal: controller.signal,
            redirect: "follow",
          }),
        {
          "http.method": "GET",
          "http.scheme": urlObj.protocol.replace(":", ""),
          "esm.package_fetch": true,
        },
      );

      const httpFetchDuration = Math.round(performance.now() - httpFetchStartTime);
      contentMetricsLog.debug("HTTP_MODULE_FETCH", {
        scheme: urlObj.protocol.replace(":", ""),
        duration_ms: httpFetchDuration,
        status: response.status,
        slow: httpFetchDuration > SLOW_HTTP_FETCH_THRESHOLD_MS,
      });

      if (!response.ok) {
        throw BUILD_FAILED.create({
          detail: `HTTP module request failed with status ${response.status}.`,
        });
      }

      const responseCode = await readHttpModuleResponse(response);
      if (responseCode === null) {
        throw BUNDLE_ERROR.create({
          detail: "HTTP module response exceeds the maximum allowed size.",
        });
      }
      code = responseCode;
    } catch (error) {
      if (error instanceof VeryfrontError) throw error;
      throw BUILD_FAILED.create({
        detail: controller.signal.aborted
          ? "HTTP module request timed out."
          : "HTTP module request failed.",
      });
    } finally {
      clearTimeout(timeout);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const isHtmlContent = contentType.includes("text/html") || looksLikeHtmlNotJs(code);

    if (isHtmlContent) {
      logger.error(
        "[HTTP-CACHE] Received HTML instead of JavaScript, likely an esm.sh error page",
        {
          ...httpLogContext(normalizedUrl),
          contentType,
        },
      );
      throw BUNDLE_ERROR.create({
        detail: "HTTP module response contains HTML instead of JavaScript.",
      });
    }

    processingStack.add(cacheIdentity);
    try {
      code = await rewriteModuleImports(code, normalizedUrl, options, cacheHttpModule);
    } finally {
      processingStack.delete(cacheIdentity);
    }

    code = embedSourceUrl(code, normalizedUrl);

    const written = await writeCacheFile(fs, cachePath, code, "HTTP-CACHE");
    if (!written) {
      throw FILE_NOT_FOUND.create({
        detail: "HTTP cache file was not created after a successful write.",
      });
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
      httpCacheLog.debug("Distributed cache set failed", {
        ...httpLogContext(normalizedUrl),
        errorName: errorLogName(error),
      });
    }

    getCachedPaths().set(cacheKey, cachePath);
    await trackBundleAccumulator(hash, normalizedUrl, cachePath);

    return cachePath;
  })();

  inFlightHttpFetches.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    clearInFlightHttpFetchIfOwned(cacheKey, fetchPromise);
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
    const replacements = await buildReplacements(
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
      httpCacheLog.debug("Failed to create bundle manifest", {
        errorName: errorLogName(error),
      });
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
