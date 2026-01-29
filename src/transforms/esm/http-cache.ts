/**
 * HTTP module cache for SSR.
 *
 * Fetches HTTP(S) modules (esm.sh, deno.land, etc.), rewrites their imports to
 * local file:// paths, and caches them on disk for runtime-agnostic loading.
 *
 * @module transforms/esm/http-cache
 */

import { createFileSystem, exists } from "#veryfront/platform/compat/fs.ts";
import { isAbsolute, join } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { simpleHash } from "#veryfront/utils/hash-utils.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { resolveImport } from "#veryfront/modules/import-map/resolver.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { getReactImportMap, REACT_VERSION } from "./package-registry.ts";
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

/** Lazy-loaded distributed cache backend for cross-pod sharing */
const getDistributedCache = createDistributedCacheAccessor(
  () => CacheBackends.httpModule(),
  "HTTP-CACHE",
);

/**
 * Generate cache key for HTTP bundles.
 * Uses simple prefix:hash format. Cache invalidation is handled by:
 * - hasIncompatibleFilePaths() for path compatibility
 * - gzip detection for corrupted content
 */
const distributedKey = (prefix: string, hash: string | number) => `${prefix}:${hash}`;

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
  // Create a NEW regex for each call to avoid race conditions with concurrent calls.
  // Global regexes maintain lastIndex state that can interleave between concurrent calls.
  const filePathPattern = /file:\/\/([^"'\s]+)/gi;

  // Extract all file:// paths
  let match;
  while ((match = filePathPattern.exec(code)) !== null) {
    const path = match[1] as string;
    // Check if this path is for an HTTP bundle (veryfront-http-bundle directory)
    if (path.includes("veryfront-http-bundle")) {
      // The path should start with our local cache directory
      if (!path.startsWith(localCacheDir)) {
        logger.debug("[HTTP-CACHE] Bundle has incompatible file path from different environment", {
          path,
          expectedDir: localCacheDir,
        });
        return true;
      }
    }
  }
  return false;
}

type CacheOptions = {
  cacheDir: string;
  importMap: ImportMapConfig;
  /** React version to use for esm.sh URLs (defaults to REACT_VERSION) */
  reactVersion?: string;
};

const cachedPaths = new LRUCache<string, string>({ maxEntries: HTTP_MODULE_CACHE_MAX_ENTRIES });
const processingStack = new Set<string>();

/** Tracks last TTL refresh per hash. Refresh every 4h to keep 20h+ remaining (24h total). */
const lastDistributedRefresh = new LRUCache<string, number>({
  maxEntries: HTTP_MODULE_CACHE_MAX_ENTRIES,
});
const DISTRIBUTED_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Module-level accumulator for bundle metadata during cacheHttpImportsToLocal. */
let bundleMetadataAccumulator: BundleEntry[] | null = null;

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
function isReactCoreUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("esm.sh")) return false;

    // Extract package name from esm.sh pathname
    // Formats: /react@version, /v150/react@version, /stable/react@version
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

function isInternalBare(specifier: string): boolean {
  return specifier.startsWith("veryfront/") ||
    specifier.startsWith("@veryfront/") ||
    specifier.startsWith("@std/");
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
  reactVersion: string = REACT_VERSION,
): string {
  // Use esm.sh URLs for React - NO npm: specifiers per plan requirements.
  // All packages use external=react to share the same React instance.
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

async function cacheHttpModule(url: string, options: CacheOptions): Promise<string | null> {
  const normalizedUrl = normalizeHttpUrl(url);

  // For Deno: Skip React core modules (prevents multiple instances).
  // All packages use external=react and import from the same esm.sh URL.
  // For Node.js: Must cache React to disk because Node.js can't import HTTP URLs.
  // The cached esm.sh bundles are ESM-compatible and work with dynamic import().
  if (isDeno && isReactCoreUrl(normalizedUrl)) {
    logger.debug("[HTTP-CACHE] Skipping React core module for Deno (prevents multiple instances)", {
      url: normalizedUrl,
    });
    return null;
  }

  const cacheDir = ensureAbsoluteDir(options.cacheDir);
  const cacheKey = `${cacheDir}:${normalizedUrl}`;

  const existing = cachedPaths.get(cacheKey);
  if (existing) return existing;

  const cachePath = join(cacheDir, `http-${simpleHash(normalizedUrl)}.mjs`);
  const fs = createFileSystem();

  if (await exists(cachePath)) {
    cachedPaths.set(cacheKey, cachePath);

    // Refresh distributed cache TTL so bundles outlive transforms that reference them.
    // Without this, bundles expire (24h) while SSR transforms (6h) are still valid.
    const distributed = await getDistributedCache();
    if (distributed) {
      const hash = simpleHash(normalizedUrl);
      const hashStr = String(hash);
      const now = Date.now();
      const lastRefresh = lastDistributedRefresh.get(hashStr);
      const needsRefresh = !lastRefresh || (now - lastRefresh > DISTRIBUTED_REFRESH_INTERVAL_MS);

      if (needsRefresh) {
        try {
          const code = await fs.readTextFile(cachePath);
          await Promise.all([
            distributed.set(distributedKey("url", hash), code, HTTP_MODULE_DISTRIBUTED_TTL_SEC),
            distributed.set(distributedKey("code", hash), code, HTTP_MODULE_DISTRIBUTED_TTL_SEC),
            distributed.set(
              distributedKey("hash", hash),
              normalizedUrl,
              HTTP_MODULE_DISTRIBUTED_TTL_SEC,
            ),
          ]);
          lastDistributedRefresh.set(hashStr, now);
          logger.debug("[HTTP-CACHE] Refreshed distributed cache TTL", { hash });

          // Co-refresh manifest TTL when any bundle is refreshed
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
    }

    // Record bundle metadata for manifest creation
    if (bundleMetadataAccumulator) {
      const stat = await createFileSystem().stat(cachePath);
      bundleMetadataAccumulator.push({
        hash: String(simpleHash(normalizedUrl)),
        url: normalizedUrl,
        sizeBytes: stat?.size ?? 0,
      });
    }

    return cachePath;
  }

  if (processingStack.has(normalizedUrl)) {
    logger.debug("[HTTP-CACHE] Circular dependency detected, returning expected path", {
      url: normalizedUrl,
    });
    return cachePath;
  }

  const distributed = await getDistributedCache();
  const hash = simpleHash(normalizedUrl);
  if (distributed) {
    try {
      // Use hash-based key instead of raw URL to comply with API cache key constraints.
      // API cache keys only allow: alphanumeric, underscore, colon, dot, asterisk, hyphen, slash.
      // URLs contain invalid characters like @, ?, =, &, etc.
      const cachedCode = await distributed.get(distributedKey("url", hash));
      if (cachedCode) {
        // Validate that the cached content is valid JavaScript, not compressed/gzipped.
        // esm.sh sometimes stores gzip-encoded bundles with "gz:" prefix that need
        // special decoding. If we see such content in the cache, skip and re-fetch.
        if (cachedCode.startsWith("gz:") || cachedCode.startsWith("gzip:")) {
          logger.warn("[HTTP-CACHE] Cached code is gzip-encoded, skipping and will re-fetch", {
            url: normalizedUrl,
            hash,
            preview: cachedCode.substring(0, 50),
          });
          // Fall through to network fetch
        } else if (hasIncompatibleFilePaths(cachedCode, cacheDir)) {
          // Cached bundle has file:// paths from a different environment (e.g., /app/...)
          // Skip the cached code and re-fetch from network to get correct local paths
          logger.warn("[HTTP-CACHE] Cached code has incompatible file paths, will re-fetch", {
            url: normalizedUrl,
            hash,
            localCacheDir: cacheDir,
          });
          // Fall through to network fetch
        } else {
          logger.debug("[HTTP-CACHE] Distributed cache hit", { url: normalizedUrl, hash });
          await fs.mkdir(cacheDir, { recursive: true });
          await fs.writeTextFile(cachePath, cachedCode);
          cachedPaths.set(cacheKey, cachePath);
          return cachePath;
        }
      }
    } catch (error) {
      logger.debug("[HTTP-CACHE] Distributed cache get failed", { url: normalizedUrl, error });
    }
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

  processingStack.add(normalizedUrl);
  try {
    code = await rewriteModuleImports(code, normalizedUrl, options);
  } finally {
    processingStack.delete(normalizedUrl);
  }

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeTextFile(cachePath, code);

  if (distributed) {
    // Store code by hash-based keys to comply with API cache key constraints.
    // API cache keys only allow: alphanumeric, underscore, colon, dot, asterisk, hyphen, slash.
    // URLs contain invalid characters (@, ?, =, &, etc.) so we use hashes instead.
    //
    // Keys stored:
    // - url:{hash}  - primary lookup key (replaces raw URL)
    // - code:{hash} - direct code recovery by hash
    // - hash:{hash} - URL mapping for debugging
    //
    // IMPORTANT: await the writes so other pods can recover this bundle immediately.
    // Without await, a transform referencing this bundle could reach Redis before
    // the bundle code does, causing ensureHttpBundlesExist on another pod to miss.
    try {
      await Promise.all([
        distributed.set(distributedKey("url", hash), code, HTTP_MODULE_DISTRIBUTED_TTL_SEC),
        distributed.set(distributedKey("code", hash), code, HTTP_MODULE_DISTRIBUTED_TTL_SEC),
        distributed.set(
          distributedKey("hash", hash),
          normalizedUrl,
          HTTP_MODULE_DISTRIBUTED_TTL_SEC,
        ),
      ]);
    } catch (error) {
      logger.debug("[HTTP-CACHE] Distributed cache set failed", { url: normalizedUrl, error });
    }
  }

  cachedPaths.set(cacheKey, cachePath);

  // Record bundle metadata for manifest creation
  if (bundleMetadataAccumulator) {
    bundleMetadataAccumulator.push({
      hash: String(hash),
      url: normalizedUrl,
      sizeBytes: code.length,
    });
  }

  return cachePath;
}

async function resolveSpecifier(
  specifier: string,
  baseUrl: string | undefined,
  options: CacheOptions,
): Promise<string | null> {
  if (isExternalScheme(specifier) || isInternalBare(specifier)) return null;

  // For Deno: Keep npm: specifiers as-is (Deno resolves them natively with auto-dedup)
  // For other runtimes: Convert to esm.sh and cache locally (or return bare specifier for React)
  if (specifier.startsWith("npm:")) {
    if (isDeno) {
      return specifier; // Let Deno's native npm resolution handle it
    }
    const bareSpecifier = specifier.slice(4); // Remove "npm:" prefix
    const esmShUrl = `https://esm.sh/${bareSpecifier}`;
    const cached = await cacheHttpModule(esmShUrl, options);
    // For React packages, cacheHttpModule returns null to prevent multiple instances.
    // Return the bare specifier so transformReactToLocalPaths can resolve it to a local file:// path.
    // For non-React packages, return the cached file:// path.
    return cached ? `file://${cached}` : bareSpecifier;
  }

  if (isHttpUrl(specifier)) {
    const cached = await cacheHttpModule(specifier, options);
    return cached ? `file://${cached}` : null;
  }

  if (isRelative(specifier)) {
    if (!baseUrl || !isHttpUrl(baseUrl)) return null;

    const resolved = new URL(specifier, baseUrl).toString();

    // For Deno: Return the full esm.sh URL for React core (not cached, to prevent multiple instances).
    // For Node.js: Cache React like other modules (Node.js can't import HTTP URLs).
    if (isDeno && isReactCoreUrl(resolved)) {
      return normalizeHttpUrl(resolved);
    }

    const cached = await cacheHttpModule(resolved, options);
    return cached ? `file://${cached}` : null;
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
  const uniqueSpecifiers = [...new Set(imports.filter((imp) => imp.n).map((imp) => imp.n!))];

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
export async function cacheHttpImportsToLocal(
  code: string,
  options: CacheOptions,
): Promise<CacheHttpImportsResult> {
  // Activate accumulator to collect bundle metadata during cacheHttpModule calls
  bundleMetadataAccumulator = [];

  try {
    const replacements = await buildReplacements(code, undefined, options);
    if (replacements.size === 0) {
      return { code };
    }

    logger.debug("[HTTP-CACHE] Cached HTTP imports", { count: replacements.size });

    const rewrittenCode = await replaceSpecifiers(
      code,
      (specifier) => replacements.get(specifier) ?? null,
    );

    // Create and store bundle manifest if bundles were cached
    const bundles = bundleMetadataAccumulator;
    if (bundles && bundles.length > 0) {
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
      }
    }

    return { code: rewrittenCode };
  } finally {
    bundleMetadataAccumulator = null;
  }
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
  const distributed = await getDistributedCache();
  if (!distributed) {
    logger.debug("[HTTP-CACHE] No distributed cache for recovery");
    return false;
  }

  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);
  const cachePath = join(absoluteCacheDir, `http-${hash}.mjs`);
  const fs = createFileSystem();

  try {
    // Strategy 1: Direct code lookup by hash (preferred - no URL needed)
    const cachedCode = await distributed.get(distributedKey("code", hash));
    if (cachedCode) {
      // Validate that the cached content is valid JavaScript, not compressed/gzipped.
      // esm.sh sometimes stores gzip-encoded bundles with "gz:" prefix that need
      // special decoding. If we see such content in the cache, skip it and re-fetch.
      if (cachedCode.startsWith("gz:") || cachedCode.startsWith("gzip:")) {
        logger.warn("[HTTP-CACHE] Cached code is gzip-encoded, skipping and will re-fetch", {
          hash,
          preview: cachedCode.substring(0, 50),
        });
        // Fall through to Strategy 2 (URL re-fetch)
      } else if (hasIncompatibleFilePaths(cachedCode, absoluteCacheDir)) {
        // Cached bundle has file:// paths from a different environment
        logger.warn("[HTTP-CACHE] Cached code has incompatible file paths, will re-fetch", {
          hash,
          localCacheDir: absoluteCacheDir,
        });
        // Fall through to Strategy 2 (URL re-fetch)
      } else {
        logger.info("[HTTP-CACHE] Recovering bundle via direct code lookup", { hash });
        await fs.mkdir(absoluteCacheDir, { recursive: true });
        await fs.writeTextFile(cachePath, cachedCode);
        logger.info("[HTTP-CACHE] Bundle recovery successful (direct)", { hash, path: cachePath });

        // Proactively recover transitive deps so the import retry doesn't
        // fail again with a different missing bundle.
        const BUNDLE_RE = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;
        const transitiveDeps: Array<{ path: string; hash: string }> = [];
        let m;
        while ((m = BUNDLE_RE.exec(cachedCode)) !== null) {
          const tHash = m[2]!;
          if (tHash !== hash) {
            transitiveDeps.push({
              path: join(absoluteCacheDir, `http-${tHash}.mjs`),
              hash: tHash,
            });
          }
        }
        if (transitiveDeps.length > 0) {
          logger.info("[HTTP-CACHE] Recovering transitive deps from last-resort recovery", {
            count: transitiveDeps.length,
          });
          await ensureHttpBundlesExist(transitiveDeps, cacheDir);
        }

        return true;
      }
    }

    // Strategy 2: URL lookup then re-fetch (fallback for bundles cached before code:{hash} was added)
    const originalUrl = await distributed.get(distributedKey("hash", hash));
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
    // Create regex per call to avoid shared lastIndex state across concurrent calls
    const bundleRe = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;
    const refs: Array<{ hash: string }> = [];
    const dedup = new Set<string>();
    let match;
    while ((match = bundleRe.exec(code)) !== null) {
      const hash = match[2] as string;
      if (!dedup.has(hash)) {
        dedup.add(hash);
        refs.push({ hash });
      }
    }
    return refs;
  };

  const pending: Array<{ hash: string }> = bundlePaths.map((b) => ({ hash: b.hash }));
  const seen = new Set<string>();
  const failed = new Set<string>();

  while (pending.length > 0) {
    const batch = pending.splice(0, pending.length).filter((b) => !seen.has(b.hash));
    if (batch.length === 0) break;

    for (const item of batch) {
      seen.add(item.hash);
    }

    // Check which bundles exist locally using canonical paths derived from
    // cacheDir + hash. Don't trust caller-provided paths — they may reference
    // a different pod's absolute directory.
    const existenceChecks = await Promise.all(
      batch.map(async ({ hash }) => ({
        hash,
        canonicalPath: join(absoluteCacheDir, `http-${hash}.mjs`),
        exists: await exists(join(absoluteCacheDir, `http-${hash}.mjs`)),
      })),
    );

    const presentLocally = existenceChecks.filter((b) => b.exists);
    const missing = existenceChecks.filter((b) => !b.exists);

    // Scan locally-present bundles for transitive deps that may be missing.
    // A bundle can exist on this pod while its transitive dependency does not
    // (e.g., Pod A created bundle X which imports bundle Y; Pod B has X from
    // a previous transform but never created Y).
    for (const { canonicalPath } of presentLocally) {
      try {
        const code = await fs.readTextFile(canonicalPath);
        for (const ref of extractBundleRefs(code)) {
          if (!seen.has(ref.hash)) pending.push(ref);
        }
      } catch { /* ignore read errors for dep scanning */ }
    }

    if (missing.length === 0) continue;

    logger.info("[HTTP-CACHE] Fetching missing bundles from distributed cache", {
      missing: missing.length,
      total: batch.length,
    });

    const distributed = await getDistributedCache();
    if (!distributed) {
      logger.error("[HTTP-CACHE] No distributed cache available for bundle recovery");
      for (const m of missing) failed.add(m.hash);
      continue;
    }

    // Batch fetch from distributed cache
    const codeKeys = missing.map((m) => distributedKey("code", m.hash));
    let codes: Map<string, string | null>;

    try {
      if (distributed.getBatch) {
        codes = await distributed.getBatch(codeKeys);
      } else {
        const results = await Promise.all(
          codeKeys.map(async (key) => [key, await distributed.get(key)] as const),
        );
        codes = new Map(results);
      }
    } catch (error) {
      logger.error("[HTTP-CACHE] Batch fetch from distributed cache failed", { error });
      for (const m of missing) failed.add(m.hash);
      continue;
    }

    // Write fetched bundles to disk using canonical paths and scan for transitive deps
    await Promise.all(
      missing.map(async ({ hash, canonicalPath }) => {
        const code = codes.get(distributedKey("code", hash));
        if (!code) {
          // Try single-bundle recovery as last resort
          const recovered = await recoverHttpBundleByHash(hash, absoluteCacheDir);
          if (!recovered) {
            failed.add(hash);
          } else {
            // Read the recovered bundle to scan for transitive deps
            try {
              const recoveredCode = await fs.readTextFile(canonicalPath);
              for (const ref of extractBundleRefs(recoveredCode)) {
                if (!seen.has(ref.hash)) pending.push(ref);
              }
            } catch { /* ignore read errors for dep scanning */ }
          }
          return;
        }

        // Validate that the cached content is valid JavaScript, not compressed/gzipped.
        // esm.sh sometimes stores gzip-encoded bundles with "gz:" prefix. Skip and fallback.
        if (code.startsWith("gz:") || code.startsWith("gzip:")) {
          logger.warn("[HTTP-CACHE] Batch-fetched code is gzip-encoded, trying single recovery", {
            hash,
            preview: code.substring(0, 50),
          });
          const recovered = await recoverHttpBundleByHash(hash, absoluteCacheDir);
          if (!recovered) {
            failed.add(hash);
          }
          return;
        }

        // Check for file:// paths from a different environment
        if (hasIncompatibleFilePaths(code, absoluteCacheDir)) {
          logger.warn(
            "[HTTP-CACHE] Batch-fetched code has incompatible file paths, trying single recovery",
            {
              hash,
              localCacheDir: absoluteCacheDir,
            },
          );
          const recovered = await recoverHttpBundleByHash(hash, absoluteCacheDir);
          if (!recovered) {
            failed.add(hash);
          }
          return;
        }

        try {
          await fs.mkdir(absoluteCacheDir, { recursive: true });
          await fs.writeTextFile(canonicalPath, code);
          logger.debug("[HTTP-CACHE] Wrote bundle to disk", { hash, path: canonicalPath });

          // Scan recovered code for transitive HTTP bundle dependencies.
          // HTTP bundles import other bundles (e.g., esm.sh packages depending
          // on other packages). Without this, Pod B recovers only the top-level
          // bundle and gets "Module not found" for transitive deps at import time.
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
