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

function parseEsmShSpecifier(url: string) {
  return parseEsmShUrl(url.replace(ESM_SH_BUILD_PREFIX, "$1"));
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

/** Module file extensions a mapping can end in when it addresses one module. */
const MODULE_FILE_SUFFIX = /\.(?:m|c)?js$|\.json$/;

/**
 * Reports whether a mapping already addresses a single module rather than a
 * package root. Such a mapping cannot take a subpath: appending one produces a
 * path below a file, as in `https://cdn.example/pkg.js/sub`.
 */
function isSingleModuleMapping(mapping: string): boolean {
  const isRemote = mapping.startsWith("http://") || mapping.startsWith("https://");
  if (!isRemote) return !mapping.startsWith("npm:");

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
