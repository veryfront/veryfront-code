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
 * `@scope/pkg[@version][/subpath]`. The version is optional and never contains
 * a slash, so taking it off first leaves the subpath as the remainder in both
 * shapes. Parsing the two shapes separately is what previously let them drift:
 * the scoped branch consumed the version as part of the package name and then
 * looked for it again, so every scoped subpath was dropped.
 *
 * The subpath is multi-segment for esm.sh build targets such as
 * `@scope/pkg@1.0/es2022/pkg.mjs`, so the whole remainder is kept.
 */
const ESM_SH_SPECIFIER = /^(@[^/]+\/[^/@]+|[^/@]+)(?:@[^/]+)?(.*)$/;

function parseEsmShSpecifier(url: string): { pkg: string; subpath: string } | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.slice(1).replace(/^v\d+\//, "");
    const match = pathname.match(ESM_SH_SPECIFIER);
    if (!match?.[1]) return null;

    const remainder = match[2] ?? "";
    return { pkg: match[1], subpath: remainder.startsWith("/") ? remainder : "" };
  } catch (_) {
    /* expected: URL may be malformed */
    return null;
  }
}

function extractEsmShPackage(url: string): string | null {
  if (!isEsmShUrl(url)) return null;
  return parseEsmShSpecifier(url)?.pkg ?? null;
}

function extractEsmShSubpath(url: string): string {
  return parseEsmShSpecifier(url)?.subpath ?? "";
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

        return mapping + subpath;
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
