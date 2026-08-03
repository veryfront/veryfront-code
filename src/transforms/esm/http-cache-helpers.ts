/**
 * URL validation, normalization, and resolution utilities for HTTP module caching.
 *
 * @module transforms/esm/http-cache-helpers
 */

import { isAbsolute, join, normalize } from "#veryfront/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import {
  primordialArrayFilter as arrayFilter,
  primordialArrayJoin as arrayJoin,
  primordialArrayMap as arrayMap,
  primordialArrayPush as arrayPush,
  primordialArraySort as arraySort,
} from "#veryfront/platform/compat/primordials/array.ts";
import { rendererLogger } from "#veryfront/utils";
import { resolveImport } from "#veryfront/modules/import-map/resolver.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { buildEsmShUrl } from "../import-rewriter/url-builder.ts";
import { parseBarePackageSpecifier } from "../shared/package-specifier.ts";
import { DEFAULT_REACT_VERSION, getReactImportMap } from "./react-cdn.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

const logger = rendererLogger.component("http-cache");
const ArrayIncludes = Array.prototype.includes;
const EncodeURIComponent = encodeURIComponent;
const JSONStringify = JSON.stringify;
const IntrinsicURL = URL;
const IntrinsicURLSearchParams = URLSearchParams;
const ObjectDefineProperty = Object.defineProperty;
const ObjectEntries = Object.entries;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const RegExpExec = RegExp.prototype.exec;
const ReflectApply = Reflect.apply;
const StringIncludes = String.prototype.includes;
const StringReplace = String.prototype.replace;
const StringSlice = String.prototype.slice;
const StringSplit = String.prototype.split;
const StringStartsWith = String.prototype.startsWith;
const URLHostnameGet = ObjectGetOwnPropertyDescriptor(
  IntrinsicURL.prototype,
  "hostname",
)!.get!;
const URLPathnameGet = ObjectGetOwnPropertyDescriptor(
  IntrinsicURL.prototype,
  "pathname",
)!.get!;
const URLPathnameSet = ObjectGetOwnPropertyDescriptor(
  IntrinsicURL.prototype,
  "pathname",
)!.set!;
const URLSearchParamsGet = ObjectGetOwnPropertyDescriptor(
  IntrinsicURL.prototype,
  "searchParams",
)!.get!;
const URLToString = IntrinsicURL.prototype.toString;
const URLSearchParamsGetValue = IntrinsicURLSearchParams.prototype.get;
const URLSearchParamsHas = IntrinsicURLSearchParams.prototype.has;
const URLSearchParamsSetValue = IntrinsicURLSearchParams.prototype.set;
const URLSearchParamsSort = IntrinsicURLSearchParams.prototype.sort;

function getURLHostname(url: URL): string {
  return ReflectApply(URLHostnameGet, url, []);
}

function getURLPathname(url: URL): string {
  return ReflectApply(URLPathnameGet, url, []);
}

function setURLPathname(url: URL, pathname: string): void {
  ReflectApply(URLPathnameSet, url, [pathname]);
}

function getURLSearchParams(url: URL): URLSearchParams {
  return ReflectApply(URLSearchParamsGet, url, []);
}

function stringifyURL(url: URL): string {
  return ReflectApply(URLToString, url, []);
}

function getURLSearchParam(searchParams: URLSearchParams, name: string): string | null {
  return ReflectApply(URLSearchParamsGetValue, searchParams, [name]);
}

function hasURLSearchParam(searchParams: URLSearchParams, name: string): boolean {
  return ReflectApply(URLSearchParamsHas, searchParams, [name]);
}

function setURLSearchParam(searchParams: URLSearchParams, name: string, value: string): void {
  ReflectApply(URLSearchParamsSetValue, searchParams, [name, value]);
}

function sortURLSearchParams(searchParams: URLSearchParams): void {
  ReflectApply(URLSearchParamsSort, searchParams, []);
}

function arrayIncludesValue<T>(values: readonly T[], value: T): boolean {
  return ReflectApply(ArrayIncludes, values, [value]);
}

function execRegExp(pattern: RegExp, value: string): RegExpExecArray | null {
  return ReflectApply(RegExpExec, pattern, [value]);
}

function testRegExp(pattern: RegExp, value: string): boolean {
  return execRegExp(pattern, value) !== null;
}

function stringIncludes(value: string, search: string): boolean {
  return ReflectApply(StringIncludes, value, [search]);
}

function stringReplace(value: string, search: string, replacement: string): string {
  return ReflectApply(StringReplace, value, [search, replacement]);
}

function stringSlice(value: string, start: number): string {
  return ReflectApply(StringSlice, value, [start]);
}

function stringSplit(value: string, separator: string): string[] {
  return ReflectApply(StringSplit, value, [separator]);
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringStartsWith, value, [search]);
}

function decodeEncodedCommas(value: string): string {
  let decoded = "";
  let index = 0;
  while (index < value.length) {
    if (
      value[index] === "%" && value[index + 1] === "2" &&
      (value[index + 2] === "C" || value[index + 2] === "c")
    ) {
      decoded += ",";
      index += 3;
      continue;
    }
    decoded += value[index];
    index++;
  }
  return decoded;
}

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
  /** Absolute request origin used to identify same-origin module-server URLs. */
  moduleServerOrigin?: string;
  /** Request-scoped dependency-pinning state used to isolate module-server URLs. */
  dependencyPinningCacheKey?: string;
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
  const imports = arraySort(ObjectEntries(importMap.imports ?? {}), compareImportMapKeys);
  const sortedScopes = arraySort(
    ObjectEntries(importMap.scopes ?? {}),
    ([left], [right]) => left < right ? -1 : left > right ? 1 : 0,
  );
  const scopes = arrayMap(
    sortedScopes,
    ([scope, scopedImports]) =>
      [
        scope,
        arraySort(ObjectEntries(scopedImports), compareImportMapKeys),
      ] as const,
  );

  // Serialize only string primitives. JSON.stringify on arrays/objects still
  // consults inherited toJSON hooks even when the intrinsic function itself
  // was captured, which would let project code collapse distinct maps onto a
  // shared cache identity.
  // Preserve the established JSON byte format exactly so this hardening does
  // not invalidate every persisted HTTP module cache entry on deployment.
  let canonical = `${HTTP_IMPORT_MAP_FINGERPRINT_NAMESPACE}\0{"imports":[`;
  for (let index = 0; index < imports.length; index++) {
    const [key, value] = imports[index]!;
    if (index > 0) canonical += ",";
    canonical += `[${JSONStringify(key)},${JSONStringify(value)}]`;
  }
  canonical += `],"scopes":[`;
  for (let scopeIndex = 0; scopeIndex < scopes.length; scopeIndex++) {
    const [scope, mappings] = scopes[scopeIndex] as [string, Array<[string, string]>];
    if (scopeIndex > 0) canonical += ",";
    canonical += `[${JSONStringify(scope)},[`;
    for (let mappingIndex = 0; mappingIndex < mappings.length; mappingIndex++) {
      const [key, value] = mappings[mappingIndex]!;
      if (mappingIndex > 0) canonical += ",";
      canonical += `[${JSONStringify(key)},${JSONStringify(value)}]`;
    }
    canonical += "]]";
  }
  canonical += "]}";
  return computeHash(canonical);
}

function attachHttpCacheRequestIdentityContext<T extends HttpCacheIdentityOptions>(
  options: T,
  context: HttpCacheRequestIdentityContext,
): T {
  ObjectDefineProperty(options, HTTP_CACHE_REQUEST_IDENTITY_CONTEXT, {
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
  const reactVersion = effective.options.reactVersion;
  return `${HTTP_CACHE_IDENTITY_NAMESPACE}:[${JSONStringify(normalizedUrl)},${
    reactVersion === undefined ? "null" : JSONStringify(reactVersion)
  },${JSONStringify(importMapFingerprint)}]`;
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
  return stringStartsWith(specifier, "https://") || stringStartsWith(specifier, "http://");
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
    const url = new IntrinsicURL(rawUrl);
    if (getURLHostname(url) !== "esm.sh") return null;

    const pathSegments = arrayFilter(
      stringSplit(getURLPathname(url), "/"),
      (segment) => segment.length > 0,
    );
    const prefix = pathSegments[0] ?? "";
    const packageIndex = prefix === "stable" || testRegExp(/^v\d+$/, prefix) ? 1 : 0;
    const match = execRegExp(
      /^(react|react-dom)@(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)$/,
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
    setURLPathname(parsed.url, `/${arrayJoin(parsed.pathSegments, "/")}`);
  }

  const effectiveOptions = {
    ...options,
    importMap: { imports: {}, scopes: {} },
    reactVersion: version,
  } as T;
  const context = getHttpCacheRequestIdentityContext(options);
  if (context) attachHttpCacheRequestIdentityContext(effectiveOptions, context);

  return { url: stringifyURL(parsed.url), options: effectiveOptions };
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
  return stringStartsWith(specifier, "node:") ||
    stringStartsWith(specifier, "data:") ||
    stringStartsWith(specifier, "file:") ||
    stringStartsWith(specifier, "bun:") ||
    stringStartsWith(specifier, "jsr:");
}

export function isRelative(specifier: string): boolean {
  return stringStartsWith(specifier, "./") || stringStartsWith(specifier, "../") ||
    stringStartsWith(specifier, "/");
}

/**
 * Check if a base URL is an HTTP URL being processed (parent module is also from esm.sh).
 * When both parent and child modules are HTTP URLs, relative paths work reliably.
 */
export function isParentHttpModule(baseUrl: string | undefined): boolean {
  return !!baseUrl && isHttpUrl(baseUrl);
}

export function isInternalBare(specifier: string): boolean {
  return stringStartsWith(specifier, "veryfront/") ||
    stringStartsWith(specifier, "#") ||
    stringStartsWith(specifier, "@std/") ||
    stringStartsWith(specifier, "_vf_modules/") ||
    stringStartsWith(specifier, "/_vf_modules/") ||
    stringStartsWith(specifier, "_veryfront/") ||
    stringStartsWith(specifier, "/_veryfront/");
}

export function normalizeEsmShUrl(url: URL): void {
  if (getURLHostname(url) !== "esm.sh") return;

  const originalPathname = getURLPathname(url);
  if (stringIncludes(originalPathname, "/denonext/")) {
    setURLPathname(url, stringReplace(originalPathname, "/denonext/", "/"));
  }

  const searchParams = getURLSearchParams(url);
  if (!hasURLSearchParam(searchParams, "target")) {
    setURLSearchParam(searchParams, "target", "es2022");
  }

  const canonicalReact = parseCanonicalReactEsmPackage(stringifyURL(url));
  const isBaseReact = canonicalReact?.packageName === "react" &&
    canonicalReact.pathSegments.length === canonicalReact.packageIndex + 1;
  if (isBaseReact) return;

  const existing = getURLSearchParam(searchParams, "external");
  const externals = existing ? stringSplit(existing, ",") : [];
  if (!arrayIncludesValue(externals, "react")) {
    arrayPush(externals, "react");
    setURLSearchParam(searchParams, "external", arrayJoin(externals, ","));
  }
}

export function normalizeHttpUrl(raw: string): string {
  try {
    const url = new IntrinsicURL(raw);
    normalizeEsmShUrl(url);
    const searchParams = getURLSearchParams(url);
    sortURLSearchParams(searchParams);
    const normalized = stringifyURL(url);

    // esm.sh misbehaves when list-valued params such as
    // `external=react,react-dom` are percent-encoded as `%2C`.
    // Preserve literal commas only for the affected param so unrelated
    // query values remain canonically encoded.
    if (getURLHostname(url) === "esm.sh") {
      const external = getURLSearchParam(searchParams, "external");
      if (!external) return normalized;

      const encodedExternal = EncodeURIComponent(external);
      return stringReplace(
        normalized,
        `external=${encodedExternal}`,
        `external=${decodeEncodedCommas(encodedExternal)}`,
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

  if (stringStartsWith(specifier, "react/")) {
    const subpath = stringSlice(specifier, "react/".length);
    return `https://esm.sh/react@${reactVersion}/${subpath}?external=react&target=es2022`;
  }

  if (stringStartsWith(specifier, "react-dom/")) {
    const subpath = stringSlice(specifier, "react-dom/".length);
    return `https://esm.sh/react-dom@${reactVersion}/${subpath}?external=react&target=es2022`;
  }

  const mapped = resolveImport(specifier, importMap);
  if (mapped !== specifier) return mapped;

  const parsed = parseBarePackageSpecifier(specifier);
  if (parsed == null) {
    return `https://esm.sh/${specifier}?target=es2022`;
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
  const expectedCacheRoot = normalize(localCacheDir);
  const expectedCacheChildPrefix = `${expectedCacheRoot}/`;

  let match: RegExpExecArray | null;
  while ((match = execRegExp(filePathPattern, code)) !== null) {
    const path = match[1]!;
    if (!stringIncludes(path, "veryfront-http-bundle")) continue;

    if (path !== expectedCacheRoot && !stringStartsWith(path, expectedCacheChildPrefix)) {
      logger.debug("Bundle has incompatible file path from different environment", {
        path,
        expectedDir: expectedCacheRoot,
      });
      return true;
    }
  }

  return false;
}
