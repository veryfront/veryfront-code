/**
 * HTTP module cache for SSR.
 *
 * Fetches HTTP(S) modules (esm.sh, deno.land, etc.), rewrites their imports to
 * local file:// paths, and caches them on disk for runtime-agnostic loading.
 *
 * @module transforms/esm/http-cache
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { gunzipSync } from "node:zlib";
import { createFileSystem, exists } from "#veryfront/platform/compat/fs.ts";
import { basename, isAbsolute, join } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { simpleHash } from "#veryfront/utils/hash-utils.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { resolveImport } from "#veryfront/modules/import-map/resolver.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { DEFAULT_REACT_VERSION, getReactImportMap } from "./package-registry.ts";
import { parseImports, replaceSpecifiers } from "./lexer.ts";
import { CacheBackends, createDistributedCacheAccessor } from "#veryfront/cache/backend.ts";
import {
  type BundleEntry,
  createBundleManifest,
  getManifestIdForHash,
  refreshManifestTTL,
  storeBundleManifest,
} from "./bundle-manifest.ts";
import {
  HTTP_MODULE_CACHE_MAX_ENTRIES,
  HTTP_MODULE_DISTRIBUTED_TTL_SEC,
} from "#veryfront/utils/constants/cache.ts";
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";

// Type-safe cache wrapper (new architecture)
import { httpBundleCache } from "./http-cache-wrapper.ts";
import {
  CACHE_DIR_TOKEN,
  asLocalModuleCode,
  CacheInvariantError,
} from "./http-cache-invariants.ts";

/** Maximum number of keys per batch request to distributed cache API */
// Note: Now handled by httpBundleCache wrapper, kept for reference during migration
const _BATCH_FETCH_CHUNK_SIZE = 100;

// Re-export CACHE_DIR_TOKEN from invariants for backwards compatibility
export { CACHE_DIR_TOKEN } from "./http-cache-invariants.ts";

/**
 * Replace local cache directory with portable token for distributed cache storage.
 * This makes cached code portable across different environments.
 */
export function tokenizeCachePaths(code: string, localCacheDir: string): string {
  // Normalize the cache dir (remove trailing slash if present)
  const normalizedDir = localCacheDir.endsWith("/") ? localCacheDir.slice(0, -1) : localCacheDir;
  return code.replaceAll(`file://${normalizedDir}`, `file://${CACHE_DIR_TOKEN}`);
}

/**
 * Replace portable token with local cache directory when loading from distributed cache.
 * This resolves the portable paths to actual local file paths.
 */
export function detokenizeCachePaths(code: string, localCacheDir: string): string {
  // Normalize the cache dir (remove trailing slash if present)
  const normalizedDir = localCacheDir.endsWith("/") ? localCacheDir.slice(0, -1) : localCacheDir;
  return code.replaceAll(`file://${CACHE_DIR_TOKEN}`, `file://${normalizedDir}`);
}

/**
 * Tokenize all cache paths in code using the base cache directory.
 * This is the preferred function for tokenizing paths before storing in distributed cache.
 * Handles both veryfront-http-bundle/ and veryfront-mdx-esm/ paths.
 */
export function tokenizeAllCachePaths(code: string): string {
  return tokenizeCachePaths(code, getCacheBaseDir());
}

/**
 * Detokenize all cache paths in code using the base cache directory.
 * This is the preferred function for detokenizing paths after loading from distributed cache.
 * Handles both veryfront-http-bundle/ and veryfront-mdx-esm/ paths.
 */
export function detokenizeAllCachePaths(code: string): string {
  return detokenizeCachePaths(code, getCacheBaseDir());
}

/**
 * Decode gzip-compressed cache content.
 * The cache may store content with a "gz:" or "gzip:" prefix followed by base64-encoded gzip data.
 * Returns the decompressed string, or null if decompression fails.
 */
function decodeGzipContent(content: string): string | null {
  const base64Data = content.startsWith("gz:")
    ? content.slice(3)
    : content.startsWith("gzip:")
    ? content.slice(5)
    : null;

  if (!base64Data) return null;

  try {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const decompressed = gunzipSync(bytes);
    return new TextDecoder().decode(decompressed);
  } catch (error) {
    logger.debug("[HTTP-CACHE] Failed to decode gzip content", { error });
    return null;
  }
}

/**
 * Check if content appears to be HTML instead of JavaScript.
 * esm.sh can return HTTP 200 with HTML error pages when packages fail to build.
 */
function looksLikeHtmlNotJs(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<HTML") ||
    /<title>ESM[^<]*<\/title>/i.test(content.slice(0, 500))
  );
}

/**
 * Try to decode content if it's gzip-encoded, otherwise return as-is.
 * Returns [decodedContent, wasGzipped] tuple.
 * Note: Now handled by httpBundleCache wrapper, kept for reference during migration.
 */
function _maybeDecodeGzip(content: string): [string, boolean] {
  if (!content.startsWith("gz:") && !content.startsWith("gzip:")) return [content, false];

  const decoded = decodeGzipContent(content);
  if (decoded) return [decoded, true];

  // Decoding failed, return original (will be handled as invalid)
  return [content, false];
}

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
 * Uses versioned prefix:hash format to enable global cache invalidation.
 *
 * Cache key format: {VERSION}:{prefix}:{hash}
 *
 * Note: Now handled by httpBundleCache wrapper, kept for reference during migration.
 */
const _distributedKey = (prefix: string, hash: string | number): string =>
  `${VERSION}:${prefix}:${hash}`;

/**
 * Check if cached HTTP bundle code has file:// paths from a different environment.
 * Returns true if the code should be rejected (has incompatible paths).
 *
 * HTTP bundles contain file:// paths to other cached bundles. These paths are
 * environment-specific (e.g., /app/.cache/... in production vs local paths on dev).
 * If the paths don't match our local cache directory, the cached code is stale.
 *
 * IMPORTANT: This function creates a new RegExp on each call to avoid race conditions
 * when multiple modules are processed concurrently. Using a shared global regex with
 * the 'g' flag would cause interleaved exec() calls to skip paths.
 */
function hasIncompatibleFilePaths(code: string, localCacheDir: string): boolean {
  const filePathPattern = /file:\/\/([^"'\s]+)/gi;

  let match: RegExpExecArray | null;
  while ((match = filePathPattern.exec(code)) !== null) {
    const path = match[1]!;
    if (!path.includes("veryfront-http-bundle")) continue;

    if (!path.startsWith(localCacheDir)) {
      logger.debug("[HTTP-CACHE] Bundle has incompatible file path from different environment", {
        path,
        expectedDir: localCacheDir,
      });
      return true;
    }
  }

  return false;
}

/**
 * Extract bundle deps (file:// paths or relative paths to http-{hash}.mjs) from code.
 * Handles both legacy absolute paths and new portable relative paths:
 * - Legacy: file:///app/.cache/veryfront-http-bundle/http-123.mjs
 * - New: ./http-123.mjs
 */
function extractBundleDeps(code: string): Array<{ path: string; hash: string }> {
  const deps: Array<{ path: string; hash: string }> = [];
  const seen = new Set<string>();

  // Match absolute file:// paths (legacy format)
  const absolutePattern = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-(\d+)\.mjs)/gi;
  let match: RegExpExecArray | null;
  while ((match = absolutePattern.exec(code)) !== null) {
    const hash = match[2]!;
    if (seen.has(hash)) continue;
    seen.add(hash);
    deps.push({ path: match[1]!, hash });
  }

  // Match relative paths (new portable format): ./http-{hash}.mjs
  const relativePattern = /["']\.\/http-(\d+)\.mjs["']/gi;
  while ((match = relativePattern.exec(code)) !== null) {
    const hash = match[1]!;
    if (seen.has(hash)) continue;
    seen.add(hash);
    // For relative paths, the "path" is just the filename since it's in the same directory
    deps.push({ path: `http-${hash}.mjs`, hash });
  }

  return deps;
}

/**
 * Validate and recover all bundle dependencies (including transitive) to local disk.
 * Used before using Redis-cached bundles - if deps are missing and
 * unrecoverable, we should re-fetch from network instead of using the cache.
 *
 * This prevents the "Module not found" error that occurs when:
 * 1. Parent bundle is cached in Redis with file:// paths to child bundles
 * 2. Child bundle's Redis keys (code:{hash}, hash:{hash}) have expired
 * 3. Parent is loaded from Redis, but children aren't on disk
 *
 * IMPORTANT: This function RECOVERS missing deps to disk, not just validates.
 * Without actual recovery, the parent bundle would be written to disk but its
 * transitive deps would be missing, causing "Module not found" at import time.
 *
 * @param deps - Array of {path, hash} for bundle dependencies to check
 * @param cacheDir - Local cache directory
 * @returns true if all deps exist or were recovered, false otherwise
 */
async function validateBundleDepsExist(
  deps: Array<{ path: string; hash: string }>,
  cacheDir: string,
): Promise<boolean> {
  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);
  const fs = createFileSystem();

  const seen = new Set<string>();
  const pending = [...deps];

  while (pending.length > 0) {
    const batch = pending.splice(0, pending.length).filter((d) => !seen.has(d.hash));
    if (batch.length === 0) break;

    for (const { hash } of batch) seen.add(hash);

    const localChecks = await Promise.all(
      batch.map(async ({ hash }) => ({
        hash,
        exists: await exists(join(absoluteCacheDir, `http-${hash}.mjs`)),
      })),
    );

    const missingDeps = localChecks.filter((c) => !c.exists);
    if (missingDeps.length === 0) {
      for (const { hash } of batch) {
        try {
          const code = await fs.readTextFile(join(absoluteCacheDir, `http-${hash}.mjs`));
          for (const dep of extractBundleDeps(code)) {
            if (!seen.has(dep.hash)) pending.push(dep);
          }
        } catch {
          /* ignore read errors */
        }
      }
      continue;
    }

    // Check if distributed cache is available
    const cacheAvailable = await httpBundleCache.isAvailable();
    if (!cacheAvailable) {
      logger.debug("[HTTP-CACHE] Cannot validate deps - no distributed cache", {
        missing: missingDeps.map((d) => d.hash),
      });
      return false;
    }

    logger.debug("[HTTP-CACHE] Recovering missing deps from Redis (batch)", {
      count: missingDeps.length,
      hashes: missingDeps.map((d) => d.hash),
    });

    // Use type-safe wrapper for batch fetch
    // The wrapper ALWAYS detokenizes, eliminating the class of bugs where we forgot to detokenize
    const codes = await httpBundleCache.getBatchCodes(missingDeps.map((d) => d.hash));

    // Process fetched codes
    for (const { hash } of missingDeps) {
      const localCode = codes.get(hash);
      if (!localCode) {
        logger.debug("[HTTP-CACHE] Dep cannot be recovered from Redis", { hash });
        return false;
      }

      const code = localCode as unknown as string;

      if (hasIncompatibleFilePaths(code, absoluteCacheDir)) {
        logger.debug("[HTTP-CACHE] Dep has incompatible paths, rejecting cache", { hash });
        return false;
      }

      const canonicalPath = join(absoluteCacheDir, `http-${hash}.mjs`);
      try {
        await fs.mkdir(absoluteCacheDir, { recursive: true });
        await fs.writeTextFile(canonicalPath, code);
        logger.debug("[HTTP-CACHE] Recovered dep from Redis", { hash });

        for (const dep of extractBundleDeps(code)) {
          if (!seen.has(dep.hash)) pending.push(dep);
        }
      } catch (error) {
        logger.error("[HTTP-CACHE] Failed to write recovered dep", { hash, error });
        return false;
      }
    }

    // URL mapping is populated lazily when modules are loaded, not during validation
    // This reduces API load during cold start recovery
  }

  logger.debug("[HTTP-CACHE] All deps recovered successfully", { count: seen.size });
  return true;
}

type CacheOptions = {
  cacheDir: string;
  importMap: ImportMapConfig;
  /** React version to use for esm.sh URLs (defaults to DEFAULT_REACT_VERSION) */
  reactVersion?: string;
};

/**
 * Cache interface for dependency injection (matches LRU essential methods).
 */
export interface HttpCacheLike<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): void;
}

/**
 * Set interface for dependency injection.
 */
export interface SetLike<T> {
  has(value: T): boolean;
  add(value: T): this;
  delete(value: T): boolean;
}

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
    return;
  }

  if (caches.cachedPaths !== undefined) injectedCachedPaths = caches.cachedPaths;
  if (caches.processingStack !== undefined) injectedProcessingStack = caches.processingStack;
  if (caches.lastDistributedRefresh !== undefined) {
    injectedLastDistributedRefresh = caches.lastDistributedRefresh;
  }
}

const DISTRIBUTED_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Per-request accumulator for bundle metadata during cacheHttpImportsToLocal. */
const bundleAccumulatorStorage = new AsyncLocalStorage<BundleEntry[]>();
/** Per-request stack used to detect circular HTTP module dependencies. */
const processingStackStorage = new AsyncLocalStorage<Set<string>>();
/** Deduplicate concurrent HTTP module fetches to avoid races. */
const inFlightHttpFetches = new Map<string, Promise<string | null>>();

function ensureAbsoluteDir(path: string): string {
  return isAbsolute(path) ? path : join(cwd(), path);
}

function isHttpUrl(specifier: string): boolean {
  return specifier.startsWith("https://") || specifier.startsWith("http://");
}

/**
 * Check if a URL is for React core packages.
 *
 * React core modules (react, react-dom) must NOT be cached/bundled.
 * Instead, all packages use external=react and import from the same esm.sh URL.
 * This prevents multiple React instances which causes "useContext is null" errors.
 */
function _isReactCoreUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("esm.sh")) return false;

    const pathname = parsed.pathname.replace(/^\/(v\d+|stable)\//, "/");
    const match = pathname.match(/^\/(react|react-dom)(@[\d.]+)?(?:\/|$|\?)/);
    return match !== null;
  } catch {
    return false;
  }
}

function isExternalScheme(specifier: string): boolean {
  return specifier.startsWith("node:") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("file:") ||
    specifier.startsWith("bun:");
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

/**
 * Check if a base URL is an HTTP URL being processed (i.e., the parent module is also from esm.sh).
 * Used to determine when relative paths can be safely used instead of absolute file:// URLs.
 *
 * When both parent and child modules are HTTP URLs (both from esm.sh), they will be cached
 * in the same directory (.cache/veryfront-http-bundle/), so relative paths work reliably.
 * This makes the cached code portable across environments without path rewriting.
 */
function isParentHttpModule(baseUrl: string | undefined): boolean {
  return !!baseUrl && isHttpUrl(baseUrl);
}

function isInternalBare(specifier: string): boolean {
  return specifier.startsWith("veryfront/") ||
    specifier.startsWith("@veryfront/") ||
    specifier.startsWith("#veryfront/") ||
    specifier.startsWith("@std/") ||
    specifier.startsWith("_vf_modules/") ||
    specifier.startsWith("/_vf_modules/") ||
    specifier.startsWith("_veryfront/") ||
    specifier.startsWith("/_veryfront/");
}

function normalizeEsmShUrl(url: URL): void {
  if (url.hostname !== "esm.sh") return;

  if (url.pathname.includes("/denonext/")) {
    url.pathname = url.pathname.replace("/denonext/", "/");
  }

  if (!url.searchParams.has("target")) {
    url.searchParams.set("target", "es2022");
  }

  const pathname = url.pathname.replace(/^\/+/, "");
  // Only skip external for BASE React package (react@version), not subpaths.
  // React subpaths (jsx-runtime, etc.) and react-dom need external=react.
  const isBaseReact = /^react@[\d.]+(?:\?|$)/.test(pathname);
  if (isBaseReact) return;

  // Add external=react to ensure all packages use the same React instance.
  // Note: We use external=react only, NOT external=react,react-dom because
  // externalizing react-dom breaks its internal imports.
  const existing = url.searchParams.get("external");
  const externals = existing ? existing.split(",") : [];
  if (!externals.includes("react")) {
    externals.push("react");
    url.searchParams.set("external", externals.join(","));
  }
}

function normalizeHttpUrl(raw: string): string {
  try {
    const url = new URL(raw);
    normalizeEsmShUrl(url);
    url.searchParams.sort();
    return url.toString();
  } catch {
    return raw;
  }
}

function resolveBareSpecifier(
  specifier: string,
  importMap: ImportMapConfig,
  reactVersion: string = DEFAULT_REACT_VERSION,
): string {
  const reactMap = getReactImportMap(reactVersion);
  const reactMapped = reactMap[specifier];
  if (reactMapped) return reactMapped;

  if (specifier.startsWith("react/")) {
    const subpath = specifier.slice("react/".length);
    return `https://esm.sh/react@${reactVersion}/${subpath}?external=react&target=es2022`;
  }

  if (specifier.startsWith("react-dom/")) {
    const subpath = specifier.slice("react-dom/".length);
    return `https://esm.sh/react-dom@${reactVersion}/${subpath}?external=react&target=es2022`;
  }

  const mapped = resolveImport(specifier, importMap);
  if (mapped !== specifier) return mapped;

  return `https://esm.sh/${specifier}?target=es2022`;
}

/**
 * Asynchronously refresh the distributed cache entry for a local bundle.
 * This is fire-and-forget to avoid blocking the hot path.
 */
function refreshDistributedCacheAsync(
  hash: number,
  code: string,
  _cacheDir: string, // Unused: wrapper uses getCacheBaseDir() internally
  normalizedUrl: string,
): void {
  (async () => {
    const hashStr = String(hash);
    const now = Date.now();
    const lastRefresh = getLastDistributedRefresh().get(hashStr);
    const needsRefresh = !lastRefresh || now - lastRefresh > DISTRIBUTED_REFRESH_INTERVAL_MS;

    if (needsRefresh) {
      try {
        // Use type-safe wrapper to store in distributed cache
        // The wrapper ALWAYS tokenizes before storing, enforcing cross-environment portability
        await httpBundleCache.setCode(
          hashStr,
          asLocalModuleCode(code),
          normalizedUrl,
          HTTP_MODULE_DISTRIBUTED_TTL_SEC,
        );
        getLastDistributedRefresh().set(hashStr, now);
        logger.debug("[HTTP-CACHE] Refreshed distributed cache TTL", { hash });

        const manifestId = getManifestIdForHash(hashStr);
        if (manifestId) {
          refreshManifestTTL(manifestId).catch((err) => {
            logger.debug("[HTTP-CACHE] Manifest TTL refresh failed", {
              manifestId: manifestId.slice(0, 12),
              err,
            });
          });
        }
      } catch (error) {
        logger.debug("[HTTP-CACHE] Distributed cache refresh failed", { hash, error });
      }
    }
  })().catch((err) => {
    logger.debug("[HTTP-CACHE] Distributed cache async refresh error", { err });
  });
}

/**
 * Track bundle for manifest accumulation if in accumulation context.
 */
function trackBundleAccumulator(hash: number, normalizedUrl: string, cachePath: string): void {
  const accumulator = bundleAccumulatorStorage.getStore();
  if (accumulator) {
    createFileSystem().stat(cachePath).then((stat) => {
      accumulator.push({
        hash: String(hash),
        url: normalizedUrl,
        sizeBytes: stat?.size ?? 0,
      });
    }).catch(() => {
      // Ignore stat errors
    });
  }
}

async function cacheHttpModuleInternal(url: string, options: CacheOptions): Promise<string | null> {
  const normalizedUrl = normalizeHttpUrl(url);

  // Note: We always cache HTTP modules to local file:// paths, including React core.
  // This ensures the same cache works for both compiled and non-compiled Deno.
  // Multiple React instances are prevented because all modules use the same
  // normalized URL -> same hash -> same local file path.

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
    // Validate that dependencies also exist locally before returning
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
        // Don't return - fall through to re-fetch
      } else {
        // Deps valid, can return the cached file
        getCachedPaths().set(cacheKey, cachePath);
        refreshDistributedCacheAsync(hash, code, cacheDir, normalizedUrl);
        trackBundleAccumulator(hash, normalizedUrl, cachePath);
        return cachePath;
      }
    } else {
      // No deps, can return immediately
      getCachedPaths().set(cacheKey, cachePath);
      refreshDistributedCacheAsync(hash, code, cacheDir, normalizedUrl);
      trackBundleAccumulator(hash, normalizedUrl, cachePath);
      return cachePath;
    }
  }

  const processingStack = getProcessingStack();
  if (processingStack.has(normalizedUrl)) {
    logger.debug("[HTTP-CACHE] Circular dependency detected, returning expected path", {
      url: normalizedUrl,
    });
    return cachePath;
  }

  const inFlight = inFlightHttpFetches.get(cacheKey);
  if (inFlight) return inFlight;

  const fetchPromise = (async () => {
    // Use type-safe wrapper for distributed cache access
    // The wrapper ALWAYS detokenizes, eliminating the class of bugs where we forgot to detokenize
    const cacheResult = await httpBundleCache.getCodeByUrl(String(hash));

    if (cacheResult.code) {
      const cachedCode = cacheResult.code as unknown as string;

      const depPattern = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-(\d+)\.mjs)/gi;
      const deps: Array<{ path: string; hash: string }> = [];
      let depMatch: RegExpExecArray | null;
      while ((depMatch = depPattern.exec(cachedCode)) !== null) {
        deps.push({ path: depMatch[1]!, hash: depMatch[2]! });
      }

      if (deps.length > 0) {
        const depsExist = await validateBundleDepsExist(deps, cacheDir);
        if (!depsExist) {
          logger.warn("[HTTP-CACHE] Cached code has missing bundle deps, will re-fetch", {
            url: normalizedUrl,
            hash,
            missingDeps: deps.length,
          });
          // Fall through to network fetch
        } else {
          logger.debug(
            cacheResult.wasGzipped
              ? "[HTTP-CACHE] Distributed cache hit (gzip decoded)"
              : "[HTTP-CACHE] Distributed cache hit",
            { url: normalizedUrl, hash },
          );
          await fs.mkdir(cacheDir, { recursive: true });
          await fs.writeTextFile(cachePath, cachedCode);
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

    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeTextFile(cachePath, code);

    // Use type-safe wrapper to store in distributed cache
    // The wrapper ALWAYS tokenizes before storing, enforcing cross-environment portability
    try {
      await httpBundleCache.setCode(
        String(hash),
        asLocalModuleCode(code),
        normalizedUrl,
        HTTP_MODULE_DISTRIBUTED_TTL_SEC,
      );
    } catch (error) {
      if (error instanceof CacheInvariantError) {
        // Invariant violations should propagate - they indicate bugs
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
    // Always cache npm: imports to local files for consistency between
    // compiled and non-compiled modes.
    const bareSpecifier = specifier.slice(4);
    const cached = await cacheHttpModule(`https://esm.sh/${bareSpecifier}`, options);
    if (!cached) return bareSpecifier;

    // Use relative path if parent is also an HTTP module (same cache directory)
    // This makes cached code portable across environments without path rewriting
    if (isParentHttpModule(baseUrl)) {
      return `./${basename(cached)}`;
    }
    return `file://${cached}`;
  }

  if (isHttpUrl(specifier)) {
    const cached = await cacheHttpModule(specifier, options);
    if (!cached) return null;

    // Use relative path if parent is also an HTTP module (same cache directory)
    if (isParentHttpModule(baseUrl)) {
      return `./${basename(cached)}`;
    }
    return `file://${cached}`;
  }

  if (isRelative(specifier)) {
    if (specifier.startsWith("/_vf_modules/")) return null;
    if (!baseUrl || !isHttpUrl(baseUrl)) return null;

    const resolved = new URL(specifier, baseUrl).toString();

    // Always cache to local files, including React core modules.
    // This ensures consistency between compiled and non-compiled modes.
    const cached = await cacheHttpModule(resolved, options);
    if (!cached) return null;

    // Relative imports within HTTP modules always use relative paths (same cache dir)
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
 * Used by server-loader.ts to cache react-dom/server and ensure the same
 * React instance is used by both components and the SSR renderer.
 *
 * @param url - The HTTP URL to cache (e.g., https://esm.sh/react-dom@18.3.1/server)
 * @param cacheDir - The cache directory path
 * @returns The local file:// URL path, or the original URL if caching fails
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
 *
 * Recovery strategy (in order of preference):
 * 1. Direct code lookup by hash (code:{hash}) - fastest, most reliable
 * 2. URL lookup then re-fetch (hash:{hash} → URL → fetch) - fallback
 *
 * @param hash - The hash from the bundle filename (e.g., "974671618" from "http-974671618.mjs")
 * @param cacheDir - The cache directory path
 * @returns true if recovery succeeded, false otherwise
 */
export async function recoverHttpBundleByHash(hash: string, cacheDir: string): Promise<boolean> {
  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);
  const cachePath = join(absoluteCacheDir, `http-${hash}.mjs`);
  const fs = createFileSystem();

  try {
    // Use type-safe wrapper for distributed cache access
    // The wrapper ALWAYS detokenizes, eliminating the class of bugs where we forgot to detokenize
    const result = await httpBundleCache.getCodeByHash(hash);

    if (result.code) {
      const cachedCode = result.code as unknown as string;

      // Additional check: verify paths are compatible with local environment
      if (hasIncompatibleFilePaths(cachedCode, absoluteCacheDir)) {
        logger.warn("[HTTP-CACHE] Cached code has incompatible file paths, will re-fetch", {
          hash,
          localCacheDir: absoluteCacheDir,
        });
        // Fall through to URL re-fetch
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
          const normalizedUrl = normalizeHttpUrl(originalUrl);
          const cacheKey = `${absoluteCacheDir}:${normalizedUrl}`;
          getCachedPaths().set(cacheKey, cachePath);
          logger.debug("[HTTP-CACHE] Updated LRU cache after recovery", { hash, cacheKey });
        }

        logger.info("[HTTP-CACHE] Bundle recovery successful (direct)", { hash, path: cachePath });

        // Extract transitive dependencies for recursive recovery
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

    logger.debug("[HTTP-CACHE] No recovery data found for hash", { hash });
    return false;
  } catch (error) {
    if (error instanceof CacheInvariantError) {
      // Invariant violations should propagate - they indicate bugs
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
 *
 * This is the preferred approach over fail-then-recover:
 * - Check first, don't wait for import to fail
 * - Batch fetch for efficiency
 * - Clear error messages if bundles not available
 *
 * @param bundlePaths - Array of {path, hash} for bundles to check
 * @param cacheDir - Cache directory for HTTP bundles
 * @returns Array of hashes that could not be recovered
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

    // Match absolute file:// paths (legacy format)
    const absoluteRe = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-(\d+)\.mjs)/gi;
    let match: RegExpExecArray | null;
    while ((match = absoluteRe.exec(code)) !== null) {
      const hash = match[2]!;
      if (dedup.has(hash)) continue;
      dedup.add(hash);
      refs.push({ hash });
    }

    // Match relative paths (new portable format): ./http-{hash}.mjs
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

    // Check if distributed cache is available
    const cacheAvailable = await httpBundleCache.isAvailable();
    if (!cacheAvailable) {
      logger.error("[HTTP-CACHE] No distributed cache available for bundle recovery");
      for (const m of missing) failed.add(m.hash);
      continue;
    }

    // Use type-safe wrapper for batch fetch
    // The wrapper ALWAYS detokenizes, eliminating the class of bugs where we forgot to detokenize
    const codes = await httpBundleCache.getBatchCodes(missing.map((m) => m.hash));

    await Promise.all(
      missing.map(async ({ hash, canonicalPath }) => {
        const localCode = codes.get(hash);
        if (!localCode) {
          // Not found in batch, try single recovery
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
            const normalizedUrl = normalizeHttpUrl(originalUrl);
            const cacheKey = `${absoluteCacheDir}:${normalizedUrl}`;
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
