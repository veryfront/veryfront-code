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
import { rendererLogger as logger } from "#veryfront/utils";
import { simpleHash } from "#veryfront/utils/hash-utils.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { resolveImport } from "#veryfront/modules/import-map/resolver.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { getDenoNpmReactMap, getReactImportMap, REACT_VERSION } from "./package-registry.ts";
import { parseImports, replaceSpecifiers } from "./lexer.ts";
import type { CacheBackend } from "#veryfront/cache/backend.ts";

/** Lazy-loaded distributed cache backend for cross-pod sharing */
let distributedCache: CacheBackend | null | undefined;
const distributedCacheInit = new Singleflight<CacheBackend | null>();

function getDistributedCache(): Promise<CacheBackend | null> {
  if (distributedCache !== undefined) return Promise.resolve(distributedCache);

  return distributedCacheInit.do("init", async () => {
    try {
      const { CacheBackends } = await import("#veryfront/cache/backend.ts");
      const backend = await CacheBackends.httpModule();

      if (backend.type === "memory") {
        distributedCache = null;
        logger.debug("[HTTP-CACHE] No distributed cache available (memory only)");
        return null;
      }

      distributedCache = backend;
      logger.debug("[HTTP-CACHE] Distributed cache initialized", { type: backend.type });
      return backend;
    } catch (error) {
      logger.debug("[HTTP-CACHE] Failed to initialize distributed cache", { error });
      distributedCache = null;
      return null;
    }
  });
}

/** TTL for cached modules in distributed cache (24 hours) */
const DISTRIBUTED_CACHE_TTL_SECONDS = 86400;

type CacheOptions = {
  cacheDir: string;
  importMap: ImportMapConfig;
  /** React version to use for esm.sh URLs (defaults to REACT_VERSION) */
  reactVersion?: string;
};

const cachedPaths = new LRUCache<string, string>({ maxEntries: 2000 });
const processingStack = new Set<string>();

function ensureAbsoluteDir(path: string): string {
  return isAbsolute(path) ? path : join(cwd(), path);
}

function isHttpUrl(specifier: string): boolean {
  return specifier.startsWith("https://") || specifier.startsWith("http://");
}

/**
 * Check if a URL is for React core packages.
 *
 * Previously, React modules were NOT cached to prevent multiple React instances.
 * Now with npm: specifiers for Deno (which auto-deduplicate) and consistent
 * esm.sh URLs with external=react for other runtimes, all code uses the same
 * React instance.
 */
function isReactCoreUrl(_url: string): boolean {
  return false;
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

function toEsmShUrlFromNpm(specifier: string): string {
  return `https://esm.sh/${specifier.slice(4)}`;
}

function resolveBareSpecifier(
  specifier: string,
  importMap: ImportMapConfig,
  reactVersion: string = REACT_VERSION,
): string {
  // For Deno SSR: Resolve React to npm: specifiers for automatic deduplication.
  // Deno's native npm resolution ensures all modules share the same React instance.
  // See: https://deno.com/blog/not-using-npm-specifiers-doing-it-wrong
  if (isDeno) {
    const denoReactMap = getDenoNpmReactMap(reactVersion);
    const denoMatch = denoReactMap[specifier];
    if (denoMatch) return denoMatch;

    // For unknown react/* or react-dom/* subpaths, construct npm: specifiers
    if (specifier.startsWith("react/") && !specifier.startsWith("react-dom")) {
      const subpath = specifier.slice("react/".length);
      return `npm:react@${reactVersion}/${subpath}`;
    }
    if (specifier.startsWith("react-dom/")) {
      const subpath = specifier.slice("react-dom/".length);
      return `npm:react-dom@${reactVersion}/${subpath}`;
    }
  }

  // For non-Deno runtimes: Use esm.sh URLs with consistent versioning.
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

  if (isReactCoreUrl(normalizedUrl)) {
    logger.debug("[HTTP-CACHE] Skipping React core module (prevents multiple instances)", {
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

    // Ensure code:{hash} exists in distributed cache for cross-pod recovery
    // This backfills bundles created before code:{hash} storage was added
    const distributed = await getDistributedCache();
    if (distributed) {
      const hash = simpleHash(normalizedUrl);
      distributed.get(`code:${hash}`).then(async (existing) => {
        if (!existing) {
          try {
            const code = await fs.readTextFile(cachePath);
            distributed.set(`code:${hash}`, code, DISTRIBUTED_CACHE_TTL_SECONDS).catch(() => {});
            logger.debug("[HTTP-CACHE] Backfilled code:{hash} for existing bundle", { hash });
          } catch {
            // Ignore read errors
          }
        }
      }).catch(() => {});
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
  if (distributed) {
    try {
      const cachedCode = await distributed.get(normalizedUrl);
      if (cachedCode) {
        logger.debug("[HTTP-CACHE] Distributed cache hit", { url: normalizedUrl });
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeTextFile(cachePath, cachedCode);
        cachedPaths.set(cacheKey, cachePath);
        return cachePath;
      }
    } catch (error) {
      logger.debug("[HTTP-CACHE] Distributed cache get failed", { url: normalizedUrl, error });
    }
  }

  logger.debug("[HTTP-CACHE] Fetching from network", { url: normalizedUrl });

  const urlObj = new URL(normalizedUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

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
    // Store code by URL, by hash (for direct recovery), and URL mapping (for debugging)
    // Storing code by hash enables recovery without needing URL lookup
    const hash = simpleHash(normalizedUrl);
    Promise.all([
      distributed.set(normalizedUrl, code, DISTRIBUTED_CACHE_TTL_SECONDS),
      distributed.set(`code:${hash}`, code, DISTRIBUTED_CACHE_TTL_SECONDS),
      distributed.set(`hash:${hash}`, normalizedUrl, DISTRIBUTED_CACHE_TTL_SECONDS),
    ]).catch((error) => {
      logger.debug("[HTTP-CACHE] Distributed cache set failed", { url: normalizedUrl, error });
    });
  }

  cachedPaths.set(cacheKey, cachePath);
  return cachePath;
}

async function resolveSpecifier(
  specifier: string,
  baseUrl: string | undefined,
  options: CacheOptions,
): Promise<string | null> {
  if (isExternalScheme(specifier) || isInternalBare(specifier)) return null;

  // For Deno: Keep npm: specifiers as-is (Deno resolves them natively with auto-dedup)
  // For other runtimes: Convert to esm.sh and cache locally
  if (specifier.startsWith("npm:")) {
    if (isDeno) {
      return specifier; // Let Deno's native npm resolution handle it
    }
    const cached = await cacheHttpModule(toEsmShUrlFromNpm(specifier), options);
    return cached ? `file://${cached}` : null;
  }

  if (isHttpUrl(specifier)) {
    const cached = await cacheHttpModule(specifier, options);
    return cached ? `file://${cached}` : null;
  }

  if (isRelative(specifier)) {
    if (!baseUrl || !isHttpUrl(baseUrl)) return null;

    const resolved = new URL(specifier, baseUrl).toString();
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

/**
 * Rewrite HTTP imports in the provided code to cached local file:// paths.
 */
export async function cacheHttpImportsToLocal(
  code: string,
  options: CacheOptions,
): Promise<string> {
  const replacements = await buildReplacements(code, undefined, options);
  if (replacements.size === 0) return code;

  logger.debug("[HTTP-CACHE] Cached HTTP imports", { count: replacements.size });

  return replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
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
    const cachedCode = await distributed.get(`code:${hash}`);
    if (cachedCode) {
      logger.info("[HTTP-CACHE] Recovering bundle via direct code lookup", { hash });
      await fs.mkdir(absoluteCacheDir, { recursive: true });
      await fs.writeTextFile(cachePath, cachedCode);
      logger.info("[HTTP-CACHE] Bundle recovery successful (direct)", { hash, path: cachePath });
      return true;
    }

    // Strategy 2: URL lookup then re-fetch (fallback for bundles cached before code:{hash} was added)
    const originalUrl = await distributed.get(`hash:${hash}`);
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
