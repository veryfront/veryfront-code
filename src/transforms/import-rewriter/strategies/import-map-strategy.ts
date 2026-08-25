import type {
  ImportMapConfig,
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { isEsmShUrl } from "../url-builder.ts";

/**
 * Splits an esm.sh path into its package name and subpath.
 *
 * esm.sh serves two specifier shapes, `pkg[@version][/subpath]` and
 * `@scope/pkg[@version][/subpath]`. Parsing them with separate rules is what
 * previously let them drift: the scoped branch consumed the version as part of
 * the package name and then looked for it again, so every scoped subpath was
 * dropped. One parse keeps the two shapes in step.
 *
 * The scan is written with indexOf rather than a regular expression because the
 * optional version and the optional subpath would otherwise both be able to
 * match the same trailing characters, which backtracks super-linearly.
 *
 * The subpath is multi-segment for esm.sh build targets such as
 * `@scope/pkg@1.0/es2022/pkg.mjs`, so the whole remainder is kept.
 */
function parseEsmShSpecifier(url: string): { pkg: string; subpath: string } | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.slice(1).replace(/^v\d+\//, "");
  } catch (_) {
    /* expected: URL may be malformed */
    return null;
  }

  // The package name spans one segment, or two when it carries a scope.
  let nameEnd: number;
  if (pathname.startsWith("@")) {
    const scopeEnd = pathname.indexOf("/");
    if (scopeEnd <= 1) return null;
    nameEnd = pathname.indexOf("/", scopeEnd + 1);
  } else {
    nameEnd = pathname.indexOf("/");
  }

  const head = nameEnd === -1 ? pathname : pathname.slice(0, nameEnd);
  const subpath = nameEnd === -1 ? "" : pathname.slice(nameEnd);

  // Any "@" after the first character starts the version, whatever it contains,
  // so non-numeric tags such as "@beta" are stripped along with "@1.0".
  const versionAt = head.indexOf("@", 1);
  const pkg = versionAt === -1 ? head : head.slice(0, versionAt);
  if (!pkg || pkg.endsWith("/")) return null;

  return { pkg, subpath };
}

function extractEsmShPackage(url: string): string | null {
  if (!isEsmShUrl(url)) return null;
  return parseEsmShSpecifier(url)?.pkg ?? null;
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
  if (boundary === -1) return mapping + subpath;

  return mapping.slice(0, boundary) + subpath + mapping.slice(boundary);
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

        const isFilePath = !mapping.startsWith("http://") &&
          !mapping.startsWith("https://") &&
          !mapping.startsWith("npm:");
        if (isFilePath) return mapping;

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
