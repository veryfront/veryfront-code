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

import { isEsmShUrl, parseEsmShUrl } from "#veryfront/transforms/shared/esm-sh-specifier.ts";

/**
 * esm.sh serves build-channel URLs such as `https://esm.sh/v135/react@18` and
 * `https://esm.sh/stable/react@18`. `parseEsmShUrl` rejects both, so the
 * channel segment is removed before parsing, leaving the package coordinate
 * that follows it.
 *
 * A channel introduces a package, so the segment counts as one only when a
 * path segment follows it. A query or fragment does not: `stable/?target=es2022`
 * is the package root written as a directory, not a channel. That leaves both `https://esm.sh/stable` and
 * `https://esm.sh/stable/` for `reservedNamePackage` to read as the package
 * named `stable`, the second being its root written as a directory.
 */
const ESM_SH_BUILD_PREFIX = /^(https?:\/\/esm\.sh\/)(?:v\d+|stable)\/(?=[^?#])/;

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
/**
 * esm.sh reserves some leading path segments, and `parseEsmShUrl` rejects any
 * specifier starting with one. npm package names can collide with them.
 */
const ESM_SH_RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  "stable",
  "gh",
  "jsr",
  "pr",
  "node",
]);

/**
 * Recovers a package whose name collides with a reserved esm.sh segment.
 *
 * Two shapes need it, and they differ in whether a subpath is allowed:
 *
 * - `v<digits>` is the build prefix. One has already been stripped by the time
 *   this runs and esm.sh does not nest them, so a leading `v<digits>` here is a
 *   package name and whatever follows is its subpath.
 * - `stable`, `gh`, `jsr`, `pr` and `node` introduce a *source*, as in
 *   `gh/owner/repo`. Only a lone segment can be a package name; anything
 *   further along belongs to the source, so it is left unresolved.
 */
function reservedNamePackage(
  url: string,
): { packageName: string; subpath: string; version: null } | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.slice(1);
  } catch (_) {
    /* expected: URL may be malformed */
    return null;
  }

  const separator = pathname.indexOf("/");
  const packageName = separator === -1 ? pathname : pathname.slice(0, separator);
  const subpath = separator === -1 ? "" : pathname.slice(separator);

  if (/^v\d+$/.test(packageName)) return { packageName, subpath, version: null };
  if (subpath === "" && ESM_SH_RESERVED_SEGMENTS.has(packageName)) {
    return { packageName, subpath, version: null };
  }

  return null;
}

/** Reports whether a package name collides with a segment esm.sh reserves. */
function isReservedCoordinateName(packageName: string): boolean {
  return /^v\d+$/.test(packageName) || ESM_SH_RESERVED_SEGMENTS.has(packageName);
}

export function parseEsmShSpecifier(
  url: string,
): { packageName: string; subpath: string; version: string | null } | null {
  const withoutBuildPrefix = url.replace(ESM_SH_BUILD_PREFIX, "$1");
  const stripped = stripTrailingSlash(withoutBuildPrefix);
  const hadTrailingSeparator = stripped !== withoutBuildPrefix;

  const coordinates = reservedNamePackage(stripped) ?? parseEsmShUrl(stripped);
  if (!coordinates) return null;

  const { packageName, subpath } = coordinates;
  return {
    packageName,
    version: coordinates.version ?? null,
    // The separator was removed only so the parse would accept the package-root
    // form. It belongs to the subpath either way: `pkg@1/sub/` addresses a
    // directory below `sub`, and `pkg@1/` addresses the package root as a
    // directory, which a URL mapping renders as a trailing separator.
    subpath: hadTrailingSeparator ? `${subpath}/` : subpath,
  };
}

/**
 * Path segments CDNs use to introduce a package coordinate, as jsDelivr does in
 * `https://cdn.jsdelivr.net/npm/chart.js`.
 */
const PACKAGE_COORDINATE_ROUTES: ReadonlySet<string> = new Set(["npm", "jsr"]);

/**
 * Reports whether a remote mapping addresses a file rather than a package root.
 *
 * The last path segment decides, but only after the package-coordinate shapes
 * are recognised, because an npm name can look exactly like a filename:
 *
 * - A segment carrying an `@` is a versioned coordinate, which keeps
 *   `https://cdn.jsdelivr.net/npm/lodash@4.17.21` a package root.
 * - A segment directly after a package route is a package name, which keeps
 *   `https://cdn.jsdelivr.net/npm/chart.js` one despite the `.js`. The scope is
 *   allowed to sit between them.
 * - Otherwise a segment carrying an extension is a file.
 *
 * An extension allowlist was tried first and kept needing entries one report at
 * a time. The shape of the name is the durable signal, but only once the
 * coordinate forms are taken out first, since `chart.js` and `pkg.js` are
 * indistinguishable as bare names.
 */
function addressesRemoteFile(mapping: string): boolean {
  const boundary = mapping.search(/[?#]/);
  const path = boundary === -1 ? mapping : mapping.slice(0, boundary);
  const segments = path.split("/");
  const lastSegment = segments.at(-1) ?? "";
  if (lastSegment.includes("@")) return false;

  const parent = segments.at(-2) ?? "";
  const routeSegment = parent.startsWith("@") ? segments.at(-3) ?? "" : parent;
  if (PACKAGE_COORDINATE_ROUTES.has(routeSegment)) return false;

  return /\.[A-Za-z0-9]+$/.test(lastSegment);
}

function coordinateSelectsExport(coordinate: string): boolean {
  const firstSeparator = coordinate.indexOf("/");
  if (firstSeparator === -1) return false;
  if (!coordinate.startsWith("@")) return true;

  return coordinate.indexOf("/", firstSeparator + 1) !== -1;
}

function isSingleModuleMapping(mapping: string): boolean {
  // npm: and jsr: name a package, so they take a subpath unless the mapping
  // already selected an export, in which case there is nothing to add it to.
  for (const scheme of ["npm:", "jsr:"]) {
    if (mapping.startsWith(scheme)) {
      return coordinateSelectsExport(mapping.slice(scheme.length));
    }
  }

  const isRemote = mapping.startsWith("http://") || mapping.startsWith("https://");
  if (!isRemote) return true;

  // An esm.sh target is a package coordinate rather than a path to a file, so
  // the parser decides rather than the suffix: a root takes a subpath, even
  // when the npm name ends in a module suffix as `chart.js` does, and one that
  // already names an export has nothing to append to. Same rule as npm and jsr.
  if (isEsmShUrl(mapping)) {
    const parsed = parseEsmShSpecifier(mapping);
    if (parsed) {
      // A reserved name cannot carry a subpath on esm.sh. Appending one to
      // `https://esm.sh/stable` yields `https://esm.sh/stable/sub`, which this
      // module reads back as the package `sub` on the stable channel, so the
      // URL would address something else entirely. Keeping the mapping exact
      // resolves the package root, which is wrong in a recoverable way rather
      // than silently pointing at a different package.
      // A version disambiguates a reserved name: esm.sh reads `stable@1` as a
      // package coordinate, so `stable@1/sub` is that package's export rather
      // than a channel route.
      if (isReservedCoordinateName(parsed.packageName) && parsed.version === null) return true;

      // A trailing separator alone is the package root written as a directory.
      return parsed.subpath !== "" && parsed.subpath !== "/";
    }
  }

  return addressesRemoteFile(mapping);
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
