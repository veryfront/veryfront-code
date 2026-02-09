/**
 * HTTP module cache for SSR.
 *
 * Fetches HTTP(S) modules (esm.sh, deno.land, etc.), rewrites their imports to
 * local file:// paths, and caches them on disk for runtime-agnostic loading.
 *
 * @module transforms/esm/http-cache
 */

import { createFileSystem, exists } from "#veryfront/platform/compat/fs.ts";
import { basename, join } from "#veryfront/compat/path/index.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { simpleHash } from "#veryfront/utils/hash-utils.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { parseImports, replaceSpecifiers } from "./lexer.ts";
import { CacheBackends, createDistributedCacheAccessor } from "#veryfront/cache/backend.ts";
import { createBundleManifest, storeBundleManifest } from "./bundle-manifest.ts";
import {
  HTTP_MODULE_CACHE_MAX_ENTRIES,
  HTTP_MODULE_DISTRIBUTED_TTL_SEC,
} from "#veryfront/utils/constants/cache.ts";
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";
import { httpBundleCache } from "./http-cache-wrapper.ts";
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
import {
  type CacheOptions,
  ensureAbsoluteDir,
  hasIncompatibleFilePaths,
  type HttpCacheLike,
  isExternalScheme,
  isHttpUrl,
  isInternalBare,
  isParentHttpModule,
  isRelative,
  normalizeHttpUrl,
  resolveBareSpecifier,
  type SetLike,
} from "./http-cache-helpers.ts";
import {
  extractBundleDeps,
  findParentBundleWithEmbeddedUrl,
  validateBundleDepsExist,
} from "./bundle-deps-validator.ts";
import {
  __clearInFlightHttpFetches,
  bundleAccumulatorStorage,
  inFlightHttpFetches,
  processingStackStorage,
  refreshDistributedCacheAsync,
  trackBundleAccumulator,
  waitForInFlightFetch,
} from "./in-flight-manager.ts";

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

/**
 * Lazy-loaded distributed cache backend for cross-pod sharing.
 * Note: Now handled by httpBundleCache wrapper, kept for reference during migration.
 */
const _getDistributedCache = createDistributedCacheAccessor(
  () => CacheBackends.httpModule(),
  "HTTP-CACHE",
);

/**
 * Generate cache key for HTTP bundles.
 * Note: Now handled by httpBundleCache wrapper, kept for reference during migration.
 */
const _distributedKey = (prefix: string, hash: string | number): string =>
  `${VERSION}:${prefix}:${hash}`;

/** Maximum number of keys per batch request to distributed cache API */
const _BATCH_FETCH_CHUNK_SIZE = 100;

const defaultCachedPaths = new LRUCache<string, string>({
  maxEntries: HTTP_MODULE_CACHE_MAX_ENTRIES,
});
const defaultProcessingStack = new Set<string>();

/** Tracks last TTL refresh per hash. Refresh every 4h to keep 20h+ remaining (24h total). */
const defaultLastDistributedRefresh = new LRUCache<string, number>({
  maxEntries: HTTP_MODULE_CACHE_MAX_ENTRIES,
});

/** Injected caches for testing */
let injectedCachedPaths: HttpCacheLike<string, string> | null = null;
let injectedProcessingStack: SetLike<string> | null = null;
let injectedLastDistributedRefresh: HttpCacheLike<string, number> | null = null;

function getCachedPaths(): HttpCacheLike<string, string> {
  return injectedCachedPaths ?? defaultCachedPaths;
}

function getProcessingStack(): SetLike<string> {
  if (injectedProcessingStack) return injectedProcessingStack;
  return processingStackStorage.getStore() ?? defaultProcessingStack;
}

function getLastDistributedRefresh(): HttpCacheLike<string, number> {
  return injectedLastDistributedRefresh ?? defaultLastDistributedRefresh;
}

/**
 * Inject custom caches for testing.
 * Call with null to restore default behavior.
 */
export function __injectCachesForTests(
  caches: {
    cachedPaths?: HttpCacheLike<string, string> | null;
    processingStack?: SetLike<string> | null;
    lastDistributedRefresh?: HttpCacheLike<string, number> | null;
  } | null,
): void {
  if (caches === null) {
    injectedCachedPaths = null;
    injectedProcessingStack = null;
    injectedLastDistributedRefresh = null;
    inFlightHttpFetches.clear();
    return;
  }

  if (caches.cachedPaths !== undefined) injectedCachedPaths = caches.cachedPaths;
  if (caches.processingStack !== undefined) injectedProcessingStack = caches.processingStack;
  if (caches.lastDistributedRefresh !== undefined) {
    injectedLastDistributedRefresh = caches.lastDistributedRefresh;
  }
}

async function cacheHttpModuleInternal(url: string, options: CacheOptions): Promise<string | null> {
  const normalizedUrl = normalizeHttpUrl(url);
  const cacheDir = ensureAbsoluteDir(options.cacheDir);
  const cacheKey = `${cacheDir}:${normalizedUrl}`;

  const existing = getCachedPaths().get(cacheKey);
  if (existing) {
    if (await exists(existing)) return existing;
    getCachedPaths().delete(cacheKey);
  }

  const hash = simpleHash(normalizedUrl);
  const cachePath = join(cacheDir, `http-${hash}.mjs`);
  const fs = createFileSystem();

  if (await exists(cachePath)) {
    const code = await fs.readTextFile(cachePath);
    const deps = extractBundleDeps(code);

    if (deps.length > 0) {
      const depsValid = await validateBundleDepsExist(deps, cacheDir);
      if (!depsValid) {
        logger.warn("[HTTP-CACHE] Local cache has missing deps, will re-fetch", {
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
          getLastDistributedRefresh,
        );
        trackBundleAccumulator(hash, normalizedUrl, cachePath);
        return cachePath;
      }
    } else {
      getCachedPaths().set(cacheKey, cachePath);
      refreshDistributedCacheAsync(hash, code, cacheDir, normalizedUrl, getLastDistributedRefresh);
      trackBundleAccumulator(hash, normalizedUrl, cachePath);
      return cachePath;
    }
  }

  const processingStack = getProcessingStack();
  if (processingStack.has(normalizedUrl)) {
    if (await exists(cachePath)) {
      logger.debug("[HTTP-CACHE] Circular dependency detected, file exists", {
        url: normalizedUrl,
      });
    } else {
      logger.debug("[HTTP-CACHE] Circular dependency detected, file pending write", {
        url: normalizedUrl,
        cachePath,
      });
    }
    return cachePath;
  }

  let inFlight = inFlightHttpFetches.get(cacheKey);
  while (inFlight) {
    const result = await waitForInFlightFetch(inFlight, cacheKey);
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
      const cachedCode = cacheResult.code as unknown as string;
      const deps = extractBundleDeps(cachedCode);

      if (deps.length > 0) {
        const depsExist = await validateBundleDepsExist(deps, cacheDir);
        if (!depsExist) {
          logger.warn("[HTTP-CACHE] Cached code has missing bundle deps, will re-fetch", {
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
            throw new Error(
              `[HTTP-CACHE] INVARIANT VIOLATION: Redis recovery write succeeded but file does not exist: ${cachePath}`,
            );
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
          throw new Error(
            `[HTTP-CACHE] INVARIANT VIOLATION: Redis recovery write succeeded but file does not exist: ${cachePath}`,
          );
        }

        getCachedPaths().set(cacheKey, cachePath);
        return cachePath;
      }
    } else if (cacheResult.failReason && cacheResult.failReason !== "not_found") {
      logger.debug("[HTTP-CACHE] Distributed cache get failed", {
        url: normalizedUrl,
        reason: cacheResult.failReason,
      });
    }

    logger.debug("[HTTP-CACHE] Fetching from network", { url: normalizedUrl });

    const urlObj = new URL(normalizedUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_FETCH_TIMEOUT_MS);

    const httpFetchStartTime = performance.now();

    const response = await withSpan(
      SpanNames.HTTP_CLIENT_FETCH,
      () =>
        fetch(normalizedUrl, {
          headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
          signal: controller.signal,
          redirect: "follow",
        }),
      {
        "http.method": "GET",
        "http.url": normalizedUrl,
        "http.host": urlObj.host,
        "http.scheme": urlObj.protocol.replace(":", ""),
        "esm.package_fetch": true,
      },
    );
    clearTimeout(timeout);

    const httpFetchDuration = Math.round(performance.now() - httpFetchStartTime);
    logger.info("[ContentMetrics] HTTP_MODULE_FETCH", {
      url: normalizedUrl.substring(0, 120),
      host: urlObj.host,
      duration_ms: httpFetchDuration,
      status: response.status,
      slow: httpFetchDuration > 500,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${normalizedUrl}: ${response.status}`);
    }

    let code = await response.text();

    const contentType = response.headers.get("content-type") ?? "";
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
      throw new Error(
        `Received HTML instead of JavaScript from ${normalizedUrl}. The package may not exist or failed to build on esm.sh.`,
      );
    }

    processingStack.add(normalizedUrl);
    try {
      code = await rewriteModuleImports(code, normalizedUrl, options);
    } finally {
      processingStack.delete(normalizedUrl);
    }

    code = embedSourceUrl(code, normalizedUrl);

    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeTextFile(cachePath, code);

    if (!(await exists(cachePath))) {
      throw new Error(
        `[HTTP-CACHE] INVARIANT VIOLATION: File write succeeded but file does not exist: ${cachePath}`,
      );
    }

    try {
      await httpBundleCache.setCode(
        String(hash),
        asLocalModuleCode(code),
        normalizedUrl,
        HTTP_MODULE_DISTRIBUTED_TTL_SEC,
      );
    } catch (error) {
      if (error instanceof VeryfrontError && error.slug === "cache-invariant-violation") {
        throw error;
      }
      logger.debug("[HTTP-CACHE] Distributed cache set failed", { url: normalizedUrl, error });
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
  if (injectedProcessingStack || processingStackStorage.getStore()) {
    return cacheHttpModuleInternal(url, options);
  }

  return processingStackStorage.run(new Set(), () => cacheHttpModuleInternal(url, options));
}

async function resolveSpecifier(
  specifier: string,
  baseUrl: string | undefined,
  options: CacheOptions,
): Promise<string | null> {
  if (isExternalScheme(specifier) || isInternalBare(specifier)) return null;

  if (specifier.startsWith("npm:")) {
    const bareSpecifier = specifier.slice(4);
    const cached = await cacheHttpModule(`https://esm.sh/${bareSpecifier}`, options);
    if (!cached) return bareSpecifier;

    if (isParentHttpModule(baseUrl)) {
      return `./${basename(cached)}`;
    }
    return `file://${cached}`;
  }

  if (isHttpUrl(specifier)) {
    const cached = await cacheHttpModule(specifier, options);
    if (!cached) return null;

    if (isParentHttpModule(baseUrl)) {
      return `./${basename(cached)}`;
    }
    return `file://${cached}`;
  }

  if (isRelative(specifier)) {
    if (specifier.startsWith("/_vf_modules/")) return null;
    if (!baseUrl || !isHttpUrl(baseUrl)) return null;

    const resolved = new URL(specifier, baseUrl).toString();

    const cached = await cacheHttpModule(resolved, options);
    if (!cached) return null;

    return `./${basename(cached)}`;
  }

  const mapped = resolveBareSpecifier(specifier, options.importMap, options.reactVersion);
  if (mapped === specifier) return null;

  return resolveSpecifier(mapped, baseUrl, options);
}

async function buildReplacements(
  code: string,
  baseUrl: string | undefined,
  options: CacheOptions,
): Promise<Map<string, string>> {
  const imports = await parseImports(code);
  const uniqueSpecifiers = [...new Set(imports.map((imp) => imp.n).filter(Boolean))] as string[];

  const results = await Promise.all(
    uniqueSpecifiers.map(async (specifier) => ({
      specifier,
      resolved: await resolveSpecifier(specifier, baseUrl, options),
    })),
  );

  const replacements = new Map<string, string>();
  for (const { specifier, resolved } of results) {
    if (resolved && resolved !== specifier) replacements.set(specifier, resolved);
  }

  return replacements;
}

async function rewriteModuleImports(
  code: string,
  moduleUrl: string,
  options: CacheOptions,
): Promise<string> {
  const replacements = await buildReplacements(code, moduleUrl, options);
  if (replacements.size === 0) return code;

  return replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}

/** Result of cacheHttpImportsToLocal including bundle manifest info. */
export interface CacheHttpImportsResult {
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
  return bundleAccumulatorStorage.run([], async () => {
    const replacements = await buildReplacements(code, undefined, options);
    if (replacements.size === 0) return { code };

    logger.debug("[HTTP-CACHE] Cached HTTP imports", { count: replacements.size });

    const rewrittenCode = await replaceSpecifiers(
      code,
      (specifier) => replacements.get(specifier) ?? null,
    );

    const bundles = bundleAccumulatorStorage.getStore();
    if (!bundles?.length) return { code: rewrittenCode };

    try {
      const manifest = await createBundleManifest(bundles);
      await storeBundleManifest(manifest);
      logger.debug("[HTTP-CACHE] Created bundle manifest", {
        manifestId: manifest.manifestId.slice(0, 12),
        bundleCount: bundles.length,
      });
      return { code: rewrittenCode, bundleManifestId: manifest.manifestId };
    } catch (error) {
      logger.debug("[HTTP-CACHE] Failed to create bundle manifest", { error });
      return { code: rewrittenCode };
    }
  });
}

/**
 * Cache a specific HTTP module URL and return its local file:// path.
 */
export async function cacheModuleToLocal(url: string, cacheDir: string): Promise<string> {
  if (!isHttpUrl(url)) return url;

  const importMap = { imports: {}, scopes: {} };
  const cached = await cacheHttpModule(url, { cacheDir, importMap });

  return cached ? `file://${cached}` : url;
}

/**
 * Recover a missing HTTP bundle by looking up the code directly from the hash.
 * Used for cross-pod recovery when a file:// path points to a bundle that
 * exists in distributed cache but not on the local filesystem.
 */
export async function recoverHttpBundleByHash(
  hash: string,
  cacheDir: string,
  parentCode?: string,
): Promise<boolean> {
  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);
  const cachePath = join(absoluteCacheDir, `http-${hash}.mjs`);
  const fs = createFileSystem();

  try {
    const result = await httpBundleCache.getCodeByHash(hash);

    if (result.code) {
      const cachedCode = result.code as unknown as string;

      if (hasIncompatibleFilePaths(cachedCode, absoluteCacheDir)) {
        logger.warn("[HTTP-CACHE] Cached code has incompatible file paths, will re-fetch", {
          hash,
          localCacheDir: absoluteCacheDir,
        });
      } else {
        logger.info(
          result.wasGzipped
            ? "[HTTP-CACHE] Recovering bundle via direct code lookup (gzip decoded)"
            : "[HTTP-CACHE] Recovering bundle via direct code lookup",
          { hash },
        );

        await fs.mkdir(absoluteCacheDir, { recursive: true });
        await fs.writeTextFile(cachePath, cachedCode);

        const originalUrl = await httpBundleCache.getOriginalUrl(hash);
        if (originalUrl) {
          const cacheKey = `${absoluteCacheDir}:${normalizeHttpUrl(originalUrl)}`;
          getCachedPaths().set(cacheKey, cachePath);
          logger.debug("[HTTP-CACHE] Updated LRU cache after recovery", { hash, cacheKey });
        }

        logger.info("[HTTP-CACHE] Bundle recovery successful (direct)", { hash, path: cachePath });

        const BUNDLE_RE = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-(\d+)\.mjs)/gi;
        const transitiveDeps: Array<{ path: string; hash: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = BUNDLE_RE.exec(cachedCode)) !== null) {
          const tHash = m[2]!;
          if (tHash === hash) continue;
          transitiveDeps.push({
            path: join(absoluteCacheDir, `http-${tHash}.mjs`),
            hash: tHash,
          });
        }

        if (transitiveDeps.length > 0) {
          logger.info("[HTTP-CACHE] Recovering transitive deps from last-resort recovery", {
            count: transitiveDeps.length,
          });
          await ensureHttpBundlesExist(transitiveDeps, cacheDir);
        }

        return true;
      }
    } else if (result.failReason) {
      logger.debug("[HTTP-CACHE] Direct code lookup failed", { hash, reason: result.failReason });
    }

    // Fallback: try to recover via URL re-fetch
    const originalUrl = await httpBundleCache.getOriginalUrl(hash);
    if (originalUrl) {
      logger.info("[HTTP-CACHE] Recovering bundle via URL re-fetch", { hash, originalUrl });
      const importMap = { imports: {}, scopes: {} };
      const result = await cacheHttpModule(originalUrl, { cacheDir, importMap });
      if (result) {
        logger.info("[HTTP-CACHE] Bundle recovery successful (re-fetch)", { hash, path: result });
        return true;
      }
    }

    // Last resort: try to extract source URL from parent bundle and re-fetch parent
    if (parentCode) {
      const parentSourceUrl = extractSourceUrl(parentCode);
      if (parentSourceUrl) {
        logger.info("[HTTP-CACHE] Attempting recovery via parent URL re-fetch", {
          hash,
          parentUrl: parentSourceUrl,
        });

        const parentHash = simpleHash(normalizeHttpUrl(parentSourceUrl));
        await httpBundleCache.deleteCode(String(parentHash));

        const parentPath = join(absoluteCacheDir, `http-${parentHash}.mjs`);
        try {
          await fs.remove(parentPath);
        } catch {
          // Ignore if file doesn't exist
        }

        const importMap = { imports: {}, scopes: {} };
        const result = await cacheHttpModule(parentSourceUrl, { cacheDir, importMap });
        if (result) {
          if (await exists(cachePath)) {
            logger.info("[HTTP-CACHE] Bundle recovery successful (parent re-fetch)", {
              hash,
              path: cachePath,
            });
            return true;
          }
        }

        logger.warn("[HTTP-CACHE] Parent re-fetch did not recover target bundle", {
          hash,
          parentUrl: parentSourceUrl,
        });
      }
    }

    // Final fallback: scan local cache for a bundle that imports this hash
    if (!parentCode) {
      const foundParent = await findParentBundleWithEmbeddedUrl(hash, absoluteCacheDir, fs);
      if (foundParent) {
        logger.info("[HTTP-CACHE] Found parent bundle in local cache, attempting recovery", {
          hash,
          parentUrl: foundParent.sourceUrl,
        });

        const parentHashNum = simpleHash(normalizeHttpUrl(foundParent.sourceUrl));
        await httpBundleCache.deleteCode(String(parentHashNum));

        try {
          await fs.remove(foundParent.path);
        } catch {
          // Ignore if file doesn't exist
        }

        const importMap = { imports: {}, scopes: {} };
        const result = await cacheHttpModule(foundParent.sourceUrl, { cacheDir, importMap });
        if (result && await exists(cachePath)) {
          logger.info("[HTTP-CACHE] Bundle recovery successful (local parent scan)", {
            hash,
            path: cachePath,
          });
          return true;
        }
      }
    }

    logger.debug("[HTTP-CACHE] No recovery data found for hash", { hash });
    return false;
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "cache-invariant-violation") {
      logger.error("[HTTP-CACHE] Cache invariant violation during recovery", { hash, error });
      throw error;
    }
    logger.error("[HTTP-CACHE] Bundle recovery failed", { hash, error });
    return false;
  }
}

/**
 * Ensure all HTTP bundles exist locally before import.
 * Proactively fetches missing bundles from distributed cache.
 */
export async function ensureHttpBundlesExist(
  bundlePaths: Array<{ path: string; hash: string }>,
  cacheDir: string,
): Promise<string[]> {
  if (bundlePaths.length === 0) return [];

  const fs = createFileSystem();
  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);

  const extractBundleRefs = (code: string): Array<{ hash: string }> => {
    const refs: Array<{ hash: string }> = [];
    const dedup = new Set<string>();

    const absoluteRe = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-(\d+)\.mjs)/gi;
    let match: RegExpExecArray | null;
    while ((match = absoluteRe.exec(code)) !== null) {
      const hash = match[2]!;
      if (dedup.has(hash)) continue;
      dedup.add(hash);
      refs.push({ hash });
    }

    const relativeRe = /["']\.\/http-(\d+)\.mjs["']/gi;
    while ((match = relativeRe.exec(code)) !== null) {
      const hash = match[1]!;
      if (dedup.has(hash)) continue;
      dedup.add(hash);
      refs.push({ hash });
    }

    return refs;
  };

  const pending: Array<{ hash: string }> = bundlePaths.map((b) => ({ hash: b.hash }));
  const seen = new Set<string>();
  const failed = new Set<string>();

  while (pending.length > 0) {
    const batch = pending.splice(0, pending.length).filter((b) => !seen.has(b.hash));
    if (batch.length === 0) break;

    for (const item of batch) seen.add(item.hash);

    const existenceChecks = await Promise.all(
      batch.map(async ({ hash }) => {
        const canonicalPath = join(absoluteCacheDir, `http-${hash}.mjs`);
        return {
          hash,
          canonicalPath,
          exists: await exists(canonicalPath),
        };
      }),
    );

    const presentLocally = existenceChecks.filter((b) => b.exists);
    const missing = existenceChecks.filter((b) => !b.exists);

    for (const { canonicalPath } of presentLocally) {
      try {
        const code = await fs.readTextFile(canonicalPath);
        for (const ref of extractBundleRefs(code)) {
          if (!seen.has(ref.hash)) pending.push(ref);
        }
      } catch {
        /* ignore read errors for dep scanning */
      }
    }

    if (missing.length === 0) continue;

    logger.info("[HTTP-CACHE] Fetching missing bundles from distributed cache", {
      missing: missing.length,
      total: batch.length,
    });

    const cacheAvailable = await httpBundleCache.isAvailable();
    if (!cacheAvailable) {
      logger.error("[HTTP-CACHE] No distributed cache available for bundle recovery");
      for (const m of missing) failed.add(m.hash);
      continue;
    }

    const codes = await httpBundleCache.getBatchCodes(missing.map((m) => m.hash));

    await Promise.all(
      missing.map(async ({ hash, canonicalPath }) => {
        const localCode = codes.get(hash);
        if (!localCode) {
          const recovered = await recoverHttpBundleByHash(hash, absoluteCacheDir);
          if (!recovered) {
            failed.add(hash);
            return;
          }

          try {
            const recoveredCode = await fs.readTextFile(canonicalPath);
            for (const ref of extractBundleRefs(recoveredCode)) {
              if (!seen.has(ref.hash)) pending.push(ref);
            }
          } catch {
            /* ignore read errors for dep scanning */
          }
          return;
        }

        const code = localCode as unknown as string;

        if (hasIncompatibleFilePaths(code, absoluteCacheDir)) {
          logger.warn(
            "[HTTP-CACHE] Batch-fetched code has incompatible file paths, trying single recovery",
            { hash, localCacheDir: absoluteCacheDir },
          );
          const recovered = await recoverHttpBundleByHash(hash, absoluteCacheDir);
          if (!recovered) failed.add(hash);
          return;
        }

        try {
          await fs.mkdir(absoluteCacheDir, { recursive: true });
          await fs.writeTextFile(canonicalPath, code);
          logger.debug("[HTTP-CACHE] Wrote bundle to disk", { hash, path: canonicalPath });

          const originalUrl = await httpBundleCache.getOriginalUrl(hash);
          if (originalUrl) {
            const cacheKey = `${absoluteCacheDir}:${normalizeHttpUrl(originalUrl)}`;
            getCachedPaths().set(cacheKey, canonicalPath);
          }

          for (const ref of extractBundleRefs(code)) {
            if (!seen.has(ref.hash)) pending.push(ref);
          }
        } catch (error) {
          logger.error("[HTTP-CACHE] Failed to write bundle to disk", { hash, error });
          failed.add(hash);
        }
      }),
    );
  }

  if (failed.size > 0) {
    logger.warn("[HTTP-CACHE] Some bundles could not be recovered", {
      failed: Array.from(failed),
    });
  }

  return Array.from(failed);
}

// Test-only export for extractBundleDeps
export const __test_extractBundleDeps = extractBundleDeps;

/**
 * Invalidate a corrupted bundle from both local and distributed cache.
 */
export async function invalidateHttpBundle(hash: string, cacheDir: string): Promise<boolean> {
  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);
  const cachePath = join(absoluteCacheDir, `http-${hash}.mjs`);
  const fs = createFileSystem();

  logger.info("[HTTP-CACHE] Invalidating bundle", { hash, path: cachePath });

  try {
    const deleted = await httpBundleCache.deleteCode(hash);
    if (deleted) {
      logger.info("[HTTP-CACHE] Deleted bundle from distributed cache", { hash });
    }

    try {
      await fs.remove(cachePath);
      logger.info("[HTTP-CACHE] Deleted local bundle file", { hash, path: cachePath });
    } catch {
      // File might not exist locally, that's fine
    }

    return true;
  } catch (error) {
    logger.error("[HTTP-CACHE] Failed to invalidate bundle", { hash, error });
    return false;
  }
}

// Export URL embedding functions for testing
export const __test_embedSourceUrl = embedSourceUrl;
export const __test_extractSourceUrl = extractSourceUrl;
