/**
 * URL validation, normalization, and resolution utilities for HTTP module caching.
 *
 * @module transforms/esm/http-cache-helpers
 */

import { isAbsolute, join } from "#veryfront/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { rendererLogger } from "#veryfront/utils";
import { resolveImport } from "#veryfront/modules/import-map/resolver.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { buildEsmShUrl } from "../import-rewriter/url-builder.ts";
import { parseBarePackageSpecifier } from "../shared/package-specifier.ts";
import { DEFAULT_REACT_VERSION, getReactImportMap } from "./package-registry.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

const logger = rendererLogger.component("http-cache");

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

export type CacheOptions = {
  cacheDir: string;
  importMap: ImportMapConfig;
  /** React version to use for esm.sh URLs (defaults to DEFAULT_REACT_VERSION) */
  reactVersion?: string;
};

export type HttpCacheIdentityOptions = Pick<CacheOptions, "importMap" | "reactVersion">;

export interface HttpCacheIdentityMetadata extends HttpCacheIdentityOptions {
  url: string;
  /** SHA-256 key for the shared distributed-cache import-map record. */
  importMapFingerprint?: string;
}

export interface EffectiveHttpCacheRequest<
  T extends HttpCacheIdentityOptions = HttpCacheIdentityOptions,
> {
  url: string;
  options: T;
}

interface HttpCacheRequestIdentityContext {
  importMapFingerprint?: Promise<string>;
  canonicalReactImportMapFingerprint?: Promise<string>;
}

const HTTP_CACHE_REQUEST_IDENTITY_CONTEXT = Symbol("http-cache-request-identity-context");

type HttpCacheRequestIdentityCarrier = {
  [HTTP_CACHE_REQUEST_IDENTITY_CONTEXT]?: HttpCacheRequestIdentityContext;
};

function compareImportMapKeys(left: [string, string], right: [string, string]): number {
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

const HTTP_IMPORT_MAP_FINGERPRINT_NAMESPACE = "veryfront:http-import-map:v2";
const HTTP_CACHE_IDENTITY_NAMESPACE = "veryfront:http-module:v2";
const HTTP_CACHE_FILE_HASH_NAMESPACE = "veryfront:http-module-file:v2";

/** Build an order-independent fingerprint covering imports and scoped imports. */
export function fingerprintImportMap(importMap: ImportMapConfig): Promise<string> {
  const imports = Object.entries(importMap.imports ?? {}).sort(compareImportMapKeys);
  const scopes = Object.entries(importMap.scopes ?? {})
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([scope, scopedImports]) => [
      scope,
      Object.entries(scopedImports).sort(compareImportMapKeys),
    ]);

  return computeHash(
    `${HTTP_IMPORT_MAP_FINGERPRINT_NAMESPACE}\0${JSON.stringify({ imports, scopes })}`,
  );
}

function attachHttpCacheRequestIdentityContext<T extends HttpCacheIdentityOptions>(
  options: T,
  context: HttpCacheRequestIdentityContext,
): T {
  Object.defineProperty(options, HTTP_CACHE_REQUEST_IDENTITY_CONTEXT, {
    configurable: false,
    enumerable: false,
    value: context,
    writable: false,
  });
  return options;
}

function getHttpCacheRequestIdentityContext(
  options: HttpCacheIdentityOptions,
): HttpCacheRequestIdentityContext | undefined {
  return (options as HttpCacheIdentityOptions & HttpCacheRequestIdentityCarrier)[
    HTTP_CACHE_REQUEST_IDENTITY_CONTEXT
  ];
}

/**
 * Snapshot an import-map fingerprint for one top-level immutable request graph.
 * Callers must create a fresh prepared options object for each top-level request.
 */
export function prepareHttpCacheRequestOptions<T extends CacheOptions>(options: T): T {
  const prepared = { ...options } as T;
  return attachHttpCacheRequestIdentityContext(prepared, {});
}

/** Preserve an existing graph snapshot, or create one for an unprepared entry point. */
export function ensurePreparedHttpCacheRequestOptions<T extends CacheOptions>(options: T): T {
  return getHttpCacheRequestIdentityContext(options)
    ? options
    : prepareHttpCacheRequestOptions(options);
}

function getRequestImportMapFingerprint(
  rawUrl: string,
  effectiveOptions: HttpCacheIdentityOptions,
): Promise<string> {
  const context = getHttpCacheRequestIdentityContext(effectiveOptions);
  if (!context) return fingerprintImportMap(effectiveOptions.importMap);

  if (!isCanonicalReactEsmUrl(rawUrl)) {
    context.importMapFingerprint ??= fingerprintImportMap(effectiveOptions.importMap);
    return context.importMapFingerprint;
  }
  context.canonicalReactImportMapFingerprint ??= fingerprintImportMap(
    effectiveOptions.importMap,
  );
  return context.canonicalReactImportMapFingerprint;
}

/** Canonical identity shared by normal caching and all recovery paths. */
export async function buildHttpCacheIdentity(
  url: string,
  options: HttpCacheIdentityOptions,
): Promise<string> {
  const effective = getEffectiveHttpCacheRequest(url, options);
  const normalizedUrl = normalizeHttpUrl(effective.url);
  const importMapFingerprint = await getRequestImportMapFingerprint(url, effective.options);
  const components = [
    normalizedUrl,
    effective.options.reactVersion ?? null,
    importMapFingerprint,
  ];
  return `${HTTP_CACHE_IDENTITY_NAMESPACE}:${JSON.stringify(components)}`;
}

/** Build recoverable metadata while reusing the request graph's import-map fingerprint. */
export async function buildHttpCacheIdentityMetadata(
  url: string,
  options: HttpCacheIdentityOptions,
): Promise<HttpCacheIdentityMetadata> {
  const effective = getEffectiveHttpCacheRequest(url, options);
  return {
    url: normalizeHttpUrl(effective.url),
    importMap: effective.options.importMap,
    reactVersion: effective.options.reactVersion,
    importMapFingerprint: await getRequestImportMapFingerprint(url, effective.options),
  };
}

/** Build the versioned, collision-resistant filename and distributed-cache hash. */
export function hashHttpCacheIdentity(identity: string): Promise<string> {
  return computeHash(`${HTTP_CACHE_FILE_HASH_NAMESPACE}\0${identity}`);
}

export function ensureAbsoluteDir(path: string): string {
  return isAbsolute(path) ? path : join(cwd(), path);
}

export function isHttpUrl(specifier: string): boolean {
  return specifier.startsWith("https://") || specifier.startsWith("http://");
}

interface CanonicalReactEsmPackage {
  packageName: "react" | "react-dom";
  version: string;
  packageIndex: number;
  url: URL;
  pathSegments: string[];
}

function parseCanonicalReactEsmPackage(rawUrl: string): CanonicalReactEsmPackage | null {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== "esm.sh") return null;

    const pathSegments = url.pathname.split("/").filter(Boolean);
    const prefix = pathSegments[0] ?? "";
    const packageIndex = prefix === "stable" || /^v\d+$/.test(prefix) ? 1 : 0;
    const match = /^(react|react-dom)@(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)$/.exec(
      pathSegments[packageIndex] ?? "",
    );
    if (!match?.[1] || !match[2]) return null;

    return {
      packageName: match[1] as "react" | "react-dom",
      version: match[2],
      packageIndex,
      url,
      pathSegments,
    };
  } catch (_) {
    /* expected: malformed URLs are not canonical React modules */
    return null;
  }
}

/** Return the exact version for an URL in React's canonical esm.sh graph. */
export function getCanonicalReactEsmVersion(rawUrl: string): string | null {
  return parseCanonicalReactEsmPackage(rawUrl)?.version ?? null;
}

/**
 * Align a canonical React URL and its cache options to one project version.
 * The URL version is authoritative when the caller has no resolved version.
 */
export function getEffectiveHttpCacheRequest<T extends HttpCacheIdentityOptions>(
  rawUrl: string,
  options: T,
): EffectiveHttpCacheRequest<T> {
  const parsed = parseCanonicalReactEsmPackage(rawUrl);
  if (!parsed) return { url: rawUrl, options };

  const version = options.reactVersion ?? parsed.version;
  if (version !== parsed.version) {
    parsed.pathSegments[parsed.packageIndex] = `${parsed.packageName}@${version}`;
    parsed.url.pathname = `/${parsed.pathSegments.join("/")}`;
  }

  const effectiveOptions = {
    ...options,
    importMap: { imports: {}, scopes: {} },
    reactVersion: version,
  } as T;
  const context = getHttpCacheRequestIdentityContext(options);
  if (context) attachHttpCacheRequestIdentityContext(effectiveOptions, context);

  return { url: parsed.url.toString(), options: effectiveOptions };
}

/**
 * Return whether an URL belongs to React's canonical esm.sh module graph.
 *
 * React must remain a process-wide singleton for a given version. Unrelated
 * project import maps therefore must not partition these modules into
 * separate local files.
 */
export function isCanonicalReactEsmUrl(rawUrl: string): boolean {
  return getCanonicalReactEsmVersion(rawUrl) !== null;
}

export function isExternalScheme(specifier: string): boolean {
  return specifier.startsWith("node:") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("file:") ||
    specifier.startsWith("bun:") ||
    specifier.startsWith("jsr:");
}

export function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

/**
 * Check if a base URL is an HTTP URL being processed (parent module is also from esm.sh).
 * When both parent and child modules are HTTP URLs, relative paths work reliably.
 */
export function isParentHttpModule(baseUrl: string | undefined): boolean {
  return !!baseUrl && isHttpUrl(baseUrl);
}

export function isInternalBare(specifier: string): boolean {
  return specifier.startsWith("veryfront/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("@std/") ||
    specifier.startsWith("_vf_modules/") ||
    specifier.startsWith("/_vf_modules/") ||
    specifier.startsWith("_veryfront/") ||
    specifier.startsWith("/_veryfront/");
}

export function normalizeEsmShUrl(url: URL): void {
  if (url.hostname !== "esm.sh") return;

  if (url.pathname.includes("/denonext/")) {
    url.pathname = url.pathname.replace("/denonext/", "/");
  }

  if (!url.searchParams.has("target")) {
    url.searchParams.set("target", "es2022");
  }

  const pathname = url.pathname.replace(/^\/+/, "");
  const isBaseReact = /^react@[\d.]+(?:\?|$)/.test(pathname);
  if (isBaseReact) return;

  const existing = url.searchParams.get("external");
  const externals = existing ? existing.split(",") : [];
  if (!externals.includes("react")) {
    externals.push("react");
    url.searchParams.set("external", externals.join(","));
  }
}

export function normalizeHttpUrl(raw: string): string {
  try {
    const url = new URL(raw);
    normalizeEsmShUrl(url);
    url.searchParams.sort();
    const normalized = url.toString();

    // esm.sh misbehaves when list-valued params such as
    // `external=react,react-dom` are percent-encoded as `%2C`.
    // Preserve literal commas only for the affected param so unrelated
    // query values remain canonically encoded.
    if (url.hostname === "esm.sh") {
      const external = url.searchParams.get("external");
      if (!external) return normalized;

      const encodedExternal = encodeURIComponent(external);
      return normalized.replace(
        `external=${encodedExternal}`,
        `external=${encodedExternal.replace(/%2C/gi, ",")}`,
      );
    }

    return normalized;
  } catch (_) {
    /* expected: URL may be malformed */
    return raw;
  }
}

export function resolveBareSpecifier(
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

  const parsed = parseBarePackageSpecifier(specifier);
  if (parsed == null) {
    return specifier;
  }

  return buildEsmShUrl(
    parsed.packageName,
    parsed.version ?? undefined,
    parsed.subpath ?? undefined,
  );
}

/**
 * Check if cached HTTP bundle code has file:// paths from a different environment.
 * Returns true if the code should be rejected (has incompatible paths).
 */
export function hasIncompatibleFilePaths(code: string, localCacheDir: string): boolean {
  const filePathPattern = /file:\/\/([^"'\s]+)/gi;

  let match: RegExpExecArray | null;
  while ((match = filePathPattern.exec(code)) !== null) {
    const path = match[1]!;
    if (!path.includes("veryfront-http-bundle")) continue;

    if (!path.startsWith(localCacheDir)) {
      logger.debug("Bundle has incompatible file path from different environment");
      return true;
    }
  }

  return false;
}
