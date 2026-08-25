import type {
  ImportMapConfig,
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { isEsmShUrl, parseEsmShUrl } from "../url-builder.ts";

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
function bareVersionLikePackage(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.slice(1);
  } catch (_) {
    /* expected: URL may be malformed */
    return null;
  }

  return /^v\d+$/.test(pathname) ? pathname : null;
}

function parseEsmShSpecifier(url: string): { packageName: string; subpath: string } | null {
  const withoutBuildPrefix = url.replace(ESM_SH_BUILD_PREFIX, "$1");
  const stripped = stripTrailingSlash(withoutBuildPrefix);

  const bareName = bareVersionLikePackage(stripped);
  if (bareName) return { packageName: bareName, subpath: "" };

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

export function resolveImportWithMap(
  specifier: string,
  importMap: ImportMapConfig,
  scope?: string,
): string | null {
  const scopedImports = scope ? importMap.scopes?.[scope] : undefined;

  const scopedExact = scopedImports?.[specifier];
  if (scopedExact) return scopedExact;

  const globalExact = importMap.imports?.[specifier];
  if (globalExact) return globalExact;

  if (isEsmShUrl(specifier)) {
    const esmShPackage = extractEsmShPackage(specifier);
    if (esmShPackage) {
      const subpath = extractEsmShSubpath(specifier);

      if (subpath) {
        const fullKey = esmShPackage + subpath;
        const subpathMapping = scopedImports?.[fullKey] ?? importMap.imports?.[fullKey];
        if (subpathMapping) return subpathMapping;
      }

      const mapping = scopedImports?.[esmShPackage] ?? importMap.imports?.[esmShPackage];
      if (mapping) {
        if (!subpath) return mapping;
        if (isSingleModuleMapping(mapping)) return mapping;

        return appendSubpath(mapping, subpath);
      }
    }
  }

  if (specifier.endsWith(".js") || specifier.endsWith(".mjs") || specifier.endsWith(".cjs")) {
    const base = specifier.replace(/\.(m|c)?js$/, "");
    const mapped = importMap.imports?.[base];
    if (mapped) return mapped;
  }

  const imports = importMap.imports;
  if (!imports) return null;

  for (const [key, value] of Object.entries(imports)) {
    if (key.endsWith("/") && specifier.startsWith(key)) {
      return value + specifier.slice(key.length);
    }
  }

  return null;
}

export class ImportMapStrategy implements ImportRewriteStrategy {
  readonly name = "import-map";
  readonly priority = 5;

  matches(specifier: string, ctx: RewriteContext): boolean {
    if (ctx.target !== "ssr" || !ctx.importMap) return false;

    const isBare = !specifier.startsWith("http") &&
      !specifier.startsWith("/") &&
      !specifier.startsWith(".");

    return isBare || isEsmShUrl(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    if (!ctx.importMap) return { specifier: null };

    const resolved = resolveImportWithMap(info.specifier, ctx.importMap);
    if (resolved && resolved !== info.specifier) return { specifier: resolved };

    return { specifier: null };
  }
}

export const importMapStrategy = new ImportMapStrategy();
