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
import { resolveImport } from "#veryfront/modules/import-map/resolver.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { getReactImportMap, REACT_VERSION } from "./package-registry.ts";
import { parseImports, replaceSpecifiers } from "./lexer.ts";

type CacheOptions = {
  cacheDir: string;
  importMap: ImportMapConfig;
  /** React version to use for esm.sh URLs (defaults to REACT_VERSION) */
  reactVersion?: string;
};

/** Singleflight for HTTP module fetch deduplication */
const httpFetchFlight = new Singleflight<string>();
const cachedPaths = new Map<string, string>();

// Track currently processing URLs to detect circular dependencies
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
 * Now with shared React facades (src/react/shared-*.ts), all code uses the same
 * cached React instance, so this check always returns false to enable caching.
 *
 * @see src/react/shared-react.ts - Cross-runtime React facade
 */
function isReactCoreUrl(_url: string): boolean {
  // With shared React facades, all React modules can be safely cached.
  // The facades ensure a single React instance across all runtimes.
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
  // Check if this is a React core package (react or react-dom)
  const isReactCore = pathname.startsWith("react@") || pathname.startsWith("react/") ||
    pathname.startsWith("react-dom@") || pathname.startsWith("react-dom/");
  if (!isReactCore) {
    // Externalize both react and react-dom to ensure version consistency
    // This prevents esm.sh from bundling its own versions of these packages
    const existing = url.searchParams.get("external");
    const externals = existing ? existing.split(",") : [];
    let needsUpdate = false;
    if (!externals.includes("react")) {
      externals.push("react");
      needsUpdate = true;
    }
    if (!externals.includes("react-dom")) {
      externals.push("react-dom");
      needsUpdate = true;
    }
    if (needsUpdate) {
      url.searchParams.set("external", externals.join(","));
    }
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
  // All bare specifiers (including React) go through esm.sh and get cached to file://
  // This ensures cross-runtime compatibility without loader hooks.
  const reactMap = getReactImportMap(reactVersion);
  if (reactMap[specifier]) return reactMap[specifier]!;

  if (specifier.startsWith("react/")) {
    const subpath = specifier.slice("react/".length);
    return `https://esm.sh/react@${reactVersion}/${subpath}?target=es2022`;
  }

  if (specifier.startsWith("react-dom/")) {
    const subpath = specifier.slice("react-dom/".length);
    return `https://esm.sh/react-dom@${reactVersion}/${subpath}?target=es2022`;
  }

  const mapped = resolveImport(specifier, importMap);
  if (mapped !== specifier) {
    return mapped;
  }

  return `https://esm.sh/${specifier}?target=es2022`;
}

function cacheHttpModule(url: string, options: CacheOptions): Promise<string | null> {
  const normalizedUrl = normalizeHttpUrl(url);

  // Don't cache React core modules - they must use the same instance as framework components
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

  // Check if we're already processing this URL (circular dependency)
  // In this case, we need to return the expected cache path without waiting
  // The file will exist by the time it's actually imported at runtime
  if (processingStack.has(normalizedUrl)) {
    const cachePath = join(cacheDir, `http-${simpleHash(normalizedUrl)}.mjs`);
    logger.debug("[HTTP-CACHE] Circular dependency detected, returning expected path", {
      url: normalizedUrl,
    });
    return cachePath;
  }

  // Use Singleflight to deduplicate concurrent fetches for the same URL.
  // This prevents race conditions where multiple requests try to write
  // the same cache file simultaneously.
  return httpFetchFlight.do(cacheKey, async () => {
    const cachePath = join(cacheDir, `http-${simpleHash(normalizedUrl)}.mjs`);

    // Double-check cache after acquiring flight (another request may have completed)
    if (await exists(cachePath)) {
      cachedPaths.set(cacheKey, cachePath);
      return cachePath;
    }

    logger.debug("[HTTP-CACHE] Fetching", { url: normalizedUrl });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(normalizedUrl, {
      headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${normalizedUrl}: ${response.status}`);
    }

    let code = await response.text();

    // Track this URL as being processed before rewriting imports
    processingStack.add(normalizedUrl);
    try {
      code = await rewriteModuleImports(code, normalizedUrl, options);
    } finally {
      processingStack.delete(normalizedUrl);
    }

    const fs = createFileSystem();
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeTextFile(cachePath, code);

    cachedPaths.set(cacheKey, cachePath);
    return cachePath;
  });
}

async function resolveSpecifier(
  specifier: string,
  baseUrl: string | undefined,
  options: CacheOptions,
): Promise<string | null> {
  if (isExternalScheme(specifier)) return null;

  if (specifier.startsWith("npm:")) {
    const url = toEsmShUrlFromNpm(specifier);
    const cached = await cacheHttpModule(url, options);
    // If caching returned null (e.g., React modules), return the URL unchanged
    return cached ? `file://${cached}` : null;
  }

  if (isHttpUrl(specifier)) {
    const cached = await cacheHttpModule(specifier, options);
    // If caching returned null (e.g., React modules), return the URL unchanged
    return cached ? `file://${cached}` : null;
  }

  if (isRelative(specifier)) {
    if (baseUrl && isHttpUrl(baseUrl)) {
      const resolved = new URL(specifier, baseUrl).toString();
      const cached = await cacheHttpModule(resolved, options);
      // If caching returned null (e.g., React modules), keep the resolved URL
      return cached ? `file://${cached}` : null;
    }
    return null;
  }

  if (isInternalBare(specifier)) {
    return null;
  }

  const mapped = resolveBareSpecifier(specifier, options.importMap, options.reactVersion);
  if (mapped === specifier) {
    return null;
  }

  return await resolveSpecifier(mapped, baseUrl, options);
}

async function rewriteModuleImports(
  code: string,
  moduleUrl: string,
  options: CacheOptions,
): Promise<string> {
  const imports = await parseImports(code);
  const replacements = new Map<string, string>();

  // Get unique specifiers to avoid duplicate resolution work
  const uniqueSpecifiers = [...new Set(imports.filter((imp) => imp.n).map((imp) => imp.n!))];

  // Resolve all imports in parallel for better performance
  const results = await Promise.all(
    uniqueSpecifiers.map(async (specifier) => {
      const resolved = await resolveSpecifier(specifier, moduleUrl, options);
      return { specifier, resolved };
    }),
  );

  for (const { specifier, resolved } of results) {
    if (resolved && resolved !== specifier) {
      replacements.set(specifier, resolved);
    }
  }

  if (replacements.size === 0) return code;

  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}

/**
 * Rewrite HTTP imports in the provided code to cached local file:// paths.
 */
export async function cacheHttpImportsToLocal(
  code: string,
  options: CacheOptions,
): Promise<string> {
  const imports = await parseImports(code);
  const replacements = new Map<string, string>();

  // Get unique specifiers to avoid duplicate resolution work
  const uniqueSpecifiers = [...new Set(imports.filter((imp) => imp.n).map((imp) => imp.n!))];

  // Resolve all imports in parallel for better performance
  const results = await Promise.all(
    uniqueSpecifiers.map(async (specifier) => {
      const resolved = await resolveSpecifier(specifier, undefined, options);
      return { specifier, resolved };
    }),
  );

  for (const { specifier, resolved } of results) {
    if (resolved && resolved !== specifier) {
      replacements.set(specifier, resolved);
    }
  }

  if (replacements.size === 0) return code;

  logger.debug("[HTTP-CACHE] Cached HTTP imports", {
    count: replacements.size,
  });

  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
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
export async function cacheModuleToLocal(
  url: string,
  cacheDir: string,
): Promise<string> {
  if (!isHttpUrl(url)) {
    return url;
  }

  const importMap = { imports: {}, scopes: {} };
  const cached = await cacheHttpModule(url, { cacheDir, importMap });

  if (cached) {
    return `file://${cached}`;
  }

  // Fallback to original URL if caching fails
  return url;
}
