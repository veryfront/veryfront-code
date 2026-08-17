/**
 * Canonical URL builders for import rewriting.
 *
 * Single source of truth for all URL generation.
 * Ensures consistent URLs across SSR and browser for hydration parity.
 */

import {
  primordialArrayJoin as arrayJoin,
  primordialArrayPush as arrayPush,
} from "#veryfront/platform/compat/primordials/array.ts";
import {
  isEsmShUrl,
  type ParsedEsmShUrl,
  parseEsmShUrl,
} from "#veryfront/transforms/shared/esm-sh-specifier.ts";

export { isEsmShUrl, type ParsedEsmShUrl, parseEsmShUrl };

/**
 * Default React version - used when not specified.
 *
 * MUST match the React version the build bundles (see `react/deno.json`),
 * because veryfront's framework React re-export is generated against that
 * version and references its named exports. A drift guard in
 * `src/utils/constants/cdn.test.ts` enforces this.
 */
export const DEFAULT_REACT_VERSION = "19.2.4";

/** Tailwind CSS version */
export const TAILWIND_VERSION = "4.1.8";

/** csstype version - must match deno.json for type consistency */
export const CSSTYPE_VERSION = "3.2.3";

type EsmShOptions = {
  external?: string[];
  target?: string;
  deps?: Record<string, string>;
};

const ObjectEntries = Object.entries;

function buildEsmShParams(options?: EsmShOptions): string[] {
  const params: string[] = [];

  if (options?.external?.length) {
    arrayPush(params, `external=${arrayJoin(options.external, ",")}`);
  }

  arrayPush(params, `target=${options?.target ?? "es2022"}`);

  if (options?.deps) {
    const deps: string[] = [];
    const entries = ObjectEntries(options.deps);
    for (let index = 0; index < entries.length; index++) {
      const [key, value] = entries[index]!;
      arrayPush(deps, `${key}@${value}`);
    }
    arrayPush(params, `deps=${arrayJoin(deps, ",")}`);
  }

  return params;
}

/**
 * Build esm.sh URL with proper configuration.
 *
 * @param pkg - Package name (e.g., "react", "lodash")
 * @param version - Package version (optional)
 * @param subpath - Subpath (e.g., "/jsx-runtime")
 * @param options - URL options
 */
export function buildEsmShUrl(
  pkg: string,
  version?: string,
  subpath?: string,
  options?: EsmShOptions,
): string {
  const params = buildEsmShParams(options);

  const versionStr = version ? `@${version}` : "";
  const pathStr = subpath ?? "";
  const queryStr = params.length ? `?${arrayJoin(params, "&")}` : "";

  return `https://esm.sh/${pkg}${versionStr}${pathStr}${queryStr}`;
}

/**
 * Build an esm.sh package-prefix URL. esm.sh's `&option/` form keeps the
 * trailing slash required by the import-map prefix-matching algorithm.
 */
function buildEsmShPrefixUrl(
  pkg: string,
  version: string,
  options?: EsmShOptions,
): string {
  const params = buildEsmShParams(options);
  const optionStr = params.length ? `&${arrayJoin(params, "&")}` : "";
  return `https://esm.sh/${pkg}@${version}${optionStr}/`;
}

/**
 * Build React esm.sh URL.
 * Uses deps=csstype for type consistency.
 */
export function buildReactUrl(
  pkg: "react" | "react-dom",
  version: string,
  subpath?: string,
  external = false,
): string {
  return buildEsmShUrl(pkg, version, subpath, {
    external: external ? ["react"] : undefined,
    deps: { csstype: CSSTYPE_VERSION },
  });
}

function buildReactPrefixUrl(
  pkg: "react" | "react-dom",
  version: string,
): string {
  return buildEsmShPrefixUrl(pkg, version, {
    external: ["react"],
    deps: { csstype: CSSTYPE_VERSION },
  });
}

/**
 * Get complete React import map for a specific version.
 */
export function getReactImportMap(version: string): Record<string, string> {
  return {
    react: buildReactUrl("react", version),
    "react-dom": buildReactUrl("react-dom", version, undefined, true),
    "react-dom/client": buildReactUrl("react-dom", version, "/client", true),
    "react-dom/server": buildReactUrl("react-dom", version, "/server", true),
    "react/jsx-runtime": buildReactUrl("react", version, "/jsx-runtime", true),
    "react/jsx-dev-runtime": buildReactUrl("react", version, "/jsx-dev-runtime", true),
    // Prefix matches cover future package exports without allowing a project
    // import map to redirect React or ReactDOM subpaths.
    "react/": buildReactPrefixUrl("react", version),
    "react-dom/": buildReactPrefixUrl("react-dom", version),
  };
}

/**
 * Build module server URL for a path.
 */
export function buildModuleServerUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

/**
 * Bind an internal module URL to the immutable dependency snapshot that
 * produced it. Flag-off keys intentionally preserve the historical URL shape.
 */
export function appendDependencyPinningKey(
  url: string,
  dependencyPinningCacheKey?: string,
): string {
  if (!dependencyPinningCacheKey?.startsWith("on:")) return url;

  const hashIndex = url.indexOf("#");
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const urlWithoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = urlWithoutHash.indexOf("?");
  const path = queryIndex === -1 ? urlWithoutHash : urlWithoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(
    queryIndex === -1 ? "" : urlWithoutHash.slice(queryIndex + 1),
  );

  params.set("pins", dependencyPinningCacheKey);
  return `${path}?${params.toString()}${hash}`;
}

const DEPENDENCY_PINNING_PATH_MARKER = "_pins/";
const MODULE_SERVER_PATH_PREFIXES = ["/_vf_modules/"] as const;
const DEPENDENCY_PINNING_PATH_KEY_PATTERN = /^on:[A-Za-z0-9._-]+$/;

interface UrlComponents {
  path: string;
  params: URLSearchParams;
  hash: string;
}

function splitUrlComponents(url: string): UrlComponents {
  const hashIndex = url.indexOf("#");
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const urlWithoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = urlWithoutHash.indexOf("?");
  return {
    path: queryIndex === -1 ? urlWithoutHash : urlWithoutHash.slice(0, queryIndex),
    params: new URLSearchParams(
      queryIndex === -1 ? "" : urlWithoutHash.slice(queryIndex + 1),
    ),
    hash,
  };
}

function decodeDependencyPinningPathKey(encodedKey: string): string | undefined {
  try {
    const cacheKey = decodeURIComponent(encodedKey);
    return DEPENDENCY_PINNING_PATH_KEY_PATTERN.test(cacheKey) ? cacheKey : undefined;
  } catch {
    return undefined;
  }
}

function hasMalformedPercentEncoding(value: string): boolean {
  try {
    decodeURIComponent(value);
    return false;
  } catch {
    return true;
  }
}

/**
 * Bind an import-map prefix target to a dependency snapshot without adding a
 * query string. Import-map prefix targets must end in `/`; placing the token in
 * a reserved path segment keeps that invariant when the browser appends the
 * concrete module suffix.
 */
export function appendDependencyPinningPathKey(
  url: string,
  dependencyPinningCacheKey?: string,
): string {
  if (!dependencyPinningCacheKey?.startsWith("on:")) return url;

  const { path, params, hash } = splitUrlComponents(url);

  for (const prefix of MODULE_SERVER_PATH_PREFIXES) {
    const prefixIndex = path.indexOf(prefix);
    if (prefixIndex === -1) continue;

    const origin = path.slice(0, prefixIndex);
    if (origin !== "" && !/^https?:\/\/[^/]+$/i.test(origin)) continue;

    let modulePath = path.slice(prefixIndex + prefix.length);
    if (modulePath.startsWith(DEPENDENCY_PINNING_PATH_MARKER)) {
      const existingKeyEnd = modulePath.indexOf(
        "/",
        DEPENDENCY_PINNING_PATH_MARKER.length,
      );
      const encodedExistingKey = existingKeyEnd === -1
        ? modulePath.slice(DEPENDENCY_PINNING_PATH_MARKER.length)
        : modulePath.slice(
          DEPENDENCY_PINNING_PATH_MARKER.length,
          existingKeyEnd,
        );
      if (decodeDependencyPinningPathKey(encodedExistingKey)) {
        if (existingKeyEnd === -1) return url;
        modulePath = modulePath.slice(existingKeyEnd + 1);
      }
    }

    params.delete("pins");
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return `${origin}${prefix}${DEPENDENCY_PINNING_PATH_MARKER}${
      encodeURIComponent(dependencyPinningCacheKey)
    }/${modulePath}${query}${hash}`;
  }
  return url;
}

/**
 * Bind a same-origin module-server URL to a dependency snapshot and canonicalize
 * it to a root-relative URL. Foreign origins are preserved byte-for-byte.
 */
export function appendSameOriginDependencyPinningPathKey(
  url: string,
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
): string {
  if (!dependencyPinningCacheKey?.startsWith("on:")) return url;

  if (url.startsWith("/_vf_modules/")) {
    return appendDependencyPinningPathKey(url, dependencyPinningCacheKey);
  }
  if (
    !moduleServerOrigin ||
    (!/^https?:\/\//i.test(url) && !url.startsWith("//"))
  ) {
    return url;
  }

  try {
    const requestOrigin = new URL(moduleServerOrigin);
    const target = new URL(url, requestOrigin);
    if (
      target.origin !== requestOrigin.origin ||
      !target.pathname.startsWith("/_vf_modules/")
    ) {
      return url;
    }

    return appendDependencyPinningPathKey(
      `${target.pathname}${target.search}${target.hash}`,
      dependencyPinningCacheKey,
    );
  } catch {
    return url;
  }
}

/**
 * Bind a same-origin absolute module URL to an SSR dependency snapshot.
 * Foreign origins and flag-off requests are preserved byte-for-byte.
 */
export function appendSameOriginSSRDependencyPinningKey(
  url: string,
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
): string {
  if (
    !dependencyPinningCacheKey?.startsWith("on:") ||
    !moduleServerOrigin ||
    (!/^https?:\/\//i.test(url) && !url.startsWith("//"))
  ) {
    return url;
  }

  try {
    const requestOrigin = new URL(moduleServerOrigin);
    const target = new URL(url, requestOrigin);
    if (
      target.origin !== requestOrigin.origin ||
      !target.pathname.startsWith("/_vf_modules/")
    ) {
      return url;
    }

    const params = target.searchParams;
    params.set("pins", dependencyPinningCacheKey);
    params.set("ssr", "true");
    return target.toString();
  } catch {
    return url;
  }
}

/**
 * Bind a same-origin absolute module URL to an SSR dependency snapshot using
 * the module-server path transport. Use this only when the consumer resolves
 * `/_vf_modules/` paths through the module server instead of generic fetch.
 */
export function appendSameOriginSSRDependencyPinningPathKey(
  url: string,
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
): string {
  if (
    !dependencyPinningCacheKey?.startsWith("on:") ||
    !moduleServerOrigin ||
    (!/^https?:\/\//i.test(url) && !url.startsWith("//"))
  ) {
    return url;
  }

  try {
    const requestOrigin = new URL(moduleServerOrigin);
    const target = new URL(url, requestOrigin);
    if (
      target.origin !== requestOrigin.origin ||
      !target.pathname.startsWith("/_vf_modules/")
    ) {
      return url;
    }

    const moduleUrl = appendDependencyPinningPathKey(
      `${target.pathname}${target.search}${target.hash}`,
      dependencyPinningCacheKey,
    );
    const { path, params, hash } = splitUrlComponents(moduleUrl);

    params.set("ssr", "true");
    return `${path}?${params.toString()}${hash}`;
  } catch {
    return url;
  }
}

export interface ExtractedDependencyPinningPath {
  pathname: string;
  cacheKey?: string;
  found: boolean;
  malformed: boolean;
}

/**
 * Remove a dependency snapshot path segment before module classification and
 * source lookup. The decoded key is validated by the request handler alongside
 * query-based tokens.
 */
export function extractDependencyPinningPathKey(
  pathname: string,
): ExtractedDependencyPinningPath {
  for (const prefix of MODULE_SERVER_PATH_PREFIXES) {
    const markerPrefix = `${prefix}${DEPENDENCY_PINNING_PATH_MARKER}`;
    if (!pathname.startsWith(markerPrefix)) continue;

    const encodedKeyAndPath = pathname.slice(markerPrefix.length);
    const separatorIndex = encodedKeyAndPath.indexOf("/");
    const encodedKey = separatorIndex === -1
      ? encodedKeyAndPath
      : encodedKeyAndPath.slice(0, separatorIndex);
    if (hasMalformedPercentEncoding(encodedKey)) {
      return { pathname, found: true, malformed: true };
    }
    const cacheKey = decodeDependencyPinningPathKey(encodedKey);
    if (!cacheKey) {
      return { pathname, found: false, malformed: false };
    }
    if (separatorIndex === -1) {
      return { pathname, found: true, malformed: true };
    }

    const modulePath = encodedKeyAndPath.slice(separatorIndex + 1);
    if (modulePath.startsWith(DEPENDENCY_PINNING_PATH_MARKER)) {
      return { pathname, found: true, malformed: true };
    }

    return {
      pathname: `${prefix}${modulePath}`,
      cacheKey,
      found: true,
      malformed: false,
    };
  }

  return { pathname, found: false, malformed: false };
}

/**
 * Build cross-project import URL.
 */
export function buildCrossProjectUrl(
  projectSlug: string,
  version: string | null,
  path: string,
): string {
  const modulePath = /\.(js|mjs|jsx|ts|tsx|mdx)$/.test(path) ? path : `${path}.tsx`;
  const projectRef = version && version !== "latest" ? `${projectSlug}@${version}` : projectSlug;
  return `/_vf_modules/_cross/${projectRef}/@/${modulePath}`;
}

/**
 * Build veryfront framework module URL.
 */
export function buildVeryfrontModuleUrl(path: string): string {
  const normalizedPath = path.replace(/\.(tsx?|jsx)$/, ".js");
  return `/_vf_modules/_veryfront/${normalizedPath}`;
}

/**
 * Normalize file extension for JavaScript output.
 */
export function normalizeExtension(path: string, options?: { removeExtension?: boolean }): string {
  if (options?.removeExtension) return path.replace(/\.(tsx?|jsx|mdx)$/, "");
  return path.replace(/\.(tsx?|jsx|mdx)$/, ".js");
}

/** Rebuild an esm.sh URL with an exact version, preserving every other part. */
export function buildPinnedEsmShUrl(parsed: ParsedEsmShUrl, version: string): string {
  return `${parsed.origin}/${parsed.packageName}@${version}${parsed.subpath}${parsed.search}${parsed.hash}`;
}

/**
 * Add deps query param to esm.sh URL if not already present.
 */
export function addEsmShDeps(url: string, reactVersion: string): string {
  if (!isEsmShUrl(url)) return url;
  if (url.includes(`react@${reactVersion}`)) return url;

  try {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    const externals = new Set<string>();

    for (const value of params.getAll("external")) {
      for (const external of value.split(",")) {
        const normalized = external.trim();
        if (normalized) externals.add(normalized);
      }
    }

    for (const external of ["react", "react-dom"]) {
      if (params.has(external)) {
        externals.add(external);
        params.delete(external);
      }
      externals.add(external);
    }

    const orderedExternals = [
      "react",
      "react-dom",
      ...Array.from(externals).filter((external) =>
        external !== "react" && external !== "react-dom"
      ),
    ];
    const target = params.get("target") ?? "es2022";
    params.delete("external");
    params.delete("target");

    const query = [
      `external=${orderedExternals.join(",")}`,
      `target=${target}`,
      ...Array.from(params.entries()).map(([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
      ),
    ].join("&");

    return `${parsed.origin}${parsed.pathname}?${query}${parsed.hash}`;
  } catch (_) {
    /* expected: malformed URL falls back to the original string */
    return url;
  }
}
