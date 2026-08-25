/**
 * Resolving an esm.sh specifier through an import map.
 *
 * This lived in two places, `import-rewriter/strategies/import-map-strategy.ts`
 * and `modules/import-map/resolver.ts`, as byte-identical copies that both
 * dropped every scoped subpath. Duplication is what let them drift from the
 * canonical parser in the first place, so the resolution lives here once and
 * both call sites delegate to it.
 *
 * @module transforms/shared/esm-sh-import-map
 */

import { isEsmShUrl, parseEsmShUrl } from "./esm-sh-specifier.ts";

/**
 * esm.sh also serves legacy build-prefixed URLs such as
 * `https://esm.sh/v135/react@18`. `parseEsmShUrl` rejects those, so the prefix
 * is stripped first to keep them resolvable through the import map, which is
 * what the previous hand-rolled parse here did.
 */
const ESM_SH_BUILD_PREFIX = /^(https?:\/\/esm\.sh\/)v\d+\//;

/** Removes a trailing separator from the path component, if there is one. */
function stripTrailingSlash(url: string): string {
  const boundary = url.search(/[?#]/);
  const path = boundary === -1 ? url : url.slice(0, boundary);
  if (!path.endsWith("/")) return url;

  return path.slice(0, -1) + (boundary === -1 ? "" : url.slice(boundary));
}

/**
 * Parses an esm.sh specifier, tolerating a trailing separator.
 *
 * `parseEsmShUrl` rejects an empty final path segment, so `@scope/pkg@1/` would
 * otherwise stop resolving through the import map entirely. The separator is
 * removed only for the parse and then restored, because on a non-empty subpath
 * it is part of the subpath: `@scope/pkg@1/sub/` and `@scope/pkg@1/sub` address
 * different things once appended to a mapping.
 */
/**
 * Recovers a package whose name is itself `v` followed by digits.
 *
 * esm.sh reserves a leading `v<digits>` segment for its build prefix, and
 * `parseEsmShUrl` rejects any specifier starting with one. A prefix always
 * precedes a package, though, so a lone `v<digits>` with nothing after it names
 * a package rather than a prefix, and `https://esm.sh/v8` must keep resolving.
 */
function bareVersionLikePackage(url: string): { packageName: string; subpath: string } | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.slice(1);
  } catch (_) {
    /* expected: URL may be malformed */
    return null;
  }

  const separator = pathname.indexOf("/");
  const packageName = separator === -1 ? pathname : pathname.slice(0, separator);
  if (!/^v\d+$/.test(packageName)) return null;

  return { packageName, subpath: separator === -1 ? "" : pathname.slice(separator) };
}

export function parseEsmShSpecifier(url: string): { packageName: string; subpath: string } | null {
  const withoutBuildPrefix = url.replace(ESM_SH_BUILD_PREFIX, "$1");
  const stripped = stripTrailingSlash(withoutBuildPrefix);

  const bareName = bareVersionLikePackage(stripped);
  if (bareName) return bareName;

  const parsed = parseEsmShUrl(stripped);
  if (!parsed) return null;

  const keepsTrailingSeparator = stripped !== withoutBuildPrefix && parsed.subpath !== "";
  return {
    packageName: parsed.packageName,
    subpath: keepsTrailingSeparator ? `${parsed.subpath}/` : parsed.subpath,
  };
}

function extractEsmShPackage(url: string): string | null {
  if (!isEsmShUrl(url)) return null;
  return parseEsmShSpecifier(url)?.packageName ?? null;
}

function extractEsmShSubpath(url: string): string {
  return parseEsmShSpecifier(url)?.subpath ?? "";
}

/**
 * Appends a subpath to a mapping, keeping it inside the path component.
 *
 * esm.sh mappings routinely carry a query, as in
 * `https://esm.sh/@scope/pkg@2?target=es2022`. Concatenating the subpath onto
 * the whole string would fold it into the last parameter value and request the
 * package root, so the subpath goes in ahead of the query or fragment.
 */
function appendSubpath(mapping: string, subpath: string): string {
  const boundary = mapping.search(/[?#]/);
  const path = boundary === -1 ? mapping : mapping.slice(0, boundary);
  const query = boundary === -1 ? "" : mapping.slice(boundary);
  // A mapping that names a directory already ends in the separator the subpath
  // starts with, and not every CDN collapses "//" back to "/".
  const joined = path.endsWith("/") ? path.slice(0, -1) + subpath : path + subpath;

  return joined + query;
}

/**
 * Module file extensions a mapping can end in when it addresses one module.
 *
 * TypeScript is included because remote TypeScript import-map values are
 * ordinary in this Deno-first repository, not just JavaScript ones.
 */
const MODULE_FILE_SUFFIX = /\.(?:[mc]?[jt]sx?|json)$/;

/**
 * Reports whether a mapping already addresses a single module rather than a
 * package root. Such a mapping cannot take a subpath: appending one produces a
 * path below a file, as in `https://cdn.example/pkg.js/sub`.
 */
function isSingleModuleMapping(mapping: string): boolean {
  // npm: and jsr: name a package, not a module, so both take a subpath.
  const isRemote = mapping.startsWith("http://") || mapping.startsWith("https://");
  if (!isRemote) return !mapping.startsWith("npm:") && !mapping.startsWith("jsr:");

  const boundary = mapping.search(/[?#]/);
  return MODULE_FILE_SUFFIX.test(boundary === -1 ? mapping : mapping.slice(0, boundary));
}

/**
 * Resolves an esm.sh specifier against an import map, or reports null when the
 * map has nothing for it.
 *
 * Scoped entries are consulted completely before either global entry. The
 * import map specification gives a matching scope precedence over the global
 * imports, so a scoped package mapping must win against a global
 * package-plus-subpath key rather than losing to it.
 */
export function resolveEsmShThroughImportMap(
  specifier: string,
  scopedImports: Record<string, string> | undefined,
  globalImports: Record<string, string> | undefined,
): string | null {
  if (!isEsmShUrl(specifier)) return null;

  const parsed = parseEsmShSpecifier(specifier);
  if (!parsed) return null;

  const { packageName, subpath } = parsed;
  const fullKey = subpath ? packageName + subpath : null;

  for (const imports of [scopedImports, globalImports]) {
    if (!imports) continue;

    // An exact package-plus-subpath entry addresses the module directly.
    const exact = fullKey ? imports[fullKey] : undefined;
    if (exact) return exact;

    const mapping = imports[packageName];
    if (!mapping) continue;
    if (!subpath) return mapping;
    if (isSingleModuleMapping(mapping)) return mapping;

    return appendSubpath(mapping, subpath);
  }

  return null;
}
