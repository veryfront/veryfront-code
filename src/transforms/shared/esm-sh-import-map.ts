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

  // Normalise before reading the tail. `pkg@18/.` and `pkg@18/` are the same
  // path, but only the normalised form ends in the separator, and the parser
  // rejects the empty final segment the raw spelling leaves behind.
  let normalized: string;
  try {
    normalized = new URL(withoutBuildPrefix).href;
  } catch (_) {
    /* expected: URL may be malformed */
    return null;
  }

  const stripped = stripTrailingSlash(normalized);
  const hadTrailingSeparator = stripped !== normalized;

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
 * CDNs that introduce a package coordinate with a leading route segment, as
 * jsDelivr does in `https://cdn.jsdelivr.net/npm/chart.js`.
 */
const PACKAGE_ROUTE_HOSTS: ReadonlySet<string> = new Set([
  "cdn.jsdelivr.net",
  "fastly.jsdelivr.net",
]);

/** The route segments those CDNs use. */
const PACKAGE_COORDINATE_ROUTES: ReadonlySet<string> = new Set(["npm", "jsr"]);

/**
 * CDNs that serve a package coordinate directly from the path root, as unpkg
 * does in `https://unpkg.com/chart.js`.
 */
const PACKAGE_ROOT_HOSTS: ReadonlySet<string> = new Set([
  "unpkg.com",
  "cdn.skypack.dev",
  "esm.run",
]);

/**
 * A file extension, which must begin with a letter.
 *
 * That rules out the last component of a version: `lodash@4.17.21` ends in
 * `.21`, which is not an extension, while `pkg@2.0.0.js` ends in one.
 */
const FILE_EXTENSION = /\.[A-Za-z][A-Za-z0-9]*$/;

/**
 * How many leading path segments a recognised package coordinate occupies, or
 * -1 when the URL is not a shape this knows.
 *
 * Both forms are tied to specific hosts. An arbitrary site may have a directory
 * called `npm`, and a path is not a package coordinate merely for containing
 * one, so the route is recognised only at the front of a known CDN's path.
 */
function isScopeSegment(segment: string | undefined): boolean {
  if (segment === undefined) return false;

  // A scope marker may arrive percent-encoded, as `%40scope`, and `pathname`
  // does not decode it.
  return segment.startsWith("@") || segment.toLowerCase().startsWith("%40");
}

function coordinateSegmentCount(url: URL, segments: readonly string[]): number {
  if (
    PACKAGE_ROUTE_HOSTS.has(url.hostname) && segments[0] !== undefined &&
    PACKAGE_COORDINATE_ROUTES.has(segments[0])
  ) {
    return isScopeSegment(segments[1]) ? 3 : 2;
  }

  if (PACKAGE_ROOT_HOSTS.has(url.hostname)) {
    return isScopeSegment(segments[0]) ? 2 : 1;
  }

  return -1;
}

/**
 * Reports whether a remote mapping addresses a file rather than a package root.
 *
 * An npm name can look exactly like a filename, so the coordinate shapes are
 * recognised before anything is read from the name itself. Where a coordinate
 * is recognised, position decides: the coordinate alone is a root, and anything
 * below it already selects an export, extensionless or not. Only outside those
 * shapes does the name decide, since there is nothing better to go on.
 *
 * A trailing separator settles it first: a path ending in one names a
 * directory, whatever its last segment looks like.
 */
function addressesRemoteFile(mapping: string): boolean {
  let url: URL;
  try {
    url = new URL(mapping);
  } catch (_) {
    /* expected: mapping may not be a URL */
    return false;
  }

  if (url.pathname.endsWith("/")) return false;

  const segments = url.pathname.split("/").filter(Boolean);
  const lastSegment = segments.at(-1) ?? "";
  if (!lastSegment) return false;

  const coordinateLength = coordinateSegmentCount(url, segments);
  if (coordinateLength !== -1) return segments.length > coordinateLength;

  // Outside a recognised shape, a version marks a coordinate unless the name
  // also carries an extension, which makes it a version-stamped file such as
  // `pkg@2.0.0.js`.
  if (lastSegment.includes("@") && !FILE_EXTENSION.test(lastSegment)) return false;

  return FILE_EXTENSION.test(lastSegment);
}

function coordinateSelectsExport(coordinate: string): boolean {
  // A trailing separator is the package root written as a directory, the same
  // reading the remote branch gives it.
  if (coordinate.endsWith("/")) return false;

  const firstSeparator = coordinate.indexOf("/");
  if (firstSeparator === -1) return false;
  if (!coordinate.startsWith("@")) return true;

  return coordinate.includes("/", firstSeparator + 1);
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
      // than a channel route. A build channel already occupying the first
      // segment does the same, since `v135/v8/sub` reads back as the package
      // `v8` while a bare `stable/sub` reads back as the package `sub`.
      const hasBuildChannel = ESM_SH_BUILD_PREFIX.test(mapping);
      if (
        isReservedCoordinateName(parsed.packageName) && parsed.version === null && !hasBuildChannel
      ) {
        return true;
      }

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
 * Resolves a coordinate against one import table.
 *
 * An exact package-plus-subpath entry addresses the module directly, so it is
 * consulted before the package entry. Reports null when the table has neither,
 * which is what lets the caller move on to the next one.
 */
function resolveThroughTable(
  imports: Record<string, string>,
  packageName: string,
  subpath: string,
): string | null {
  if (subpath) {
    const exact = imports[packageName + subpath];
    if (exact) return exact;
  }

  const mapping = imports[packageName];
  if (!mapping) return null;
  if (!subpath) return mapping;
  if (isSingleModuleMapping(mapping)) return mapping;

  return appendSubpath(mapping, subpath);
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

  for (const imports of [scopedImports, globalImports]) {
    if (!imports) continue;

    const resolved = resolveThroughTable(imports, parsed.packageName, parsed.subpath);
    if (resolved) return resolved;
  }

  return null;
}
