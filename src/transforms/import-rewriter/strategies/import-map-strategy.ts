import type {
  ImportMapConfig,
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { isEsmShUrl } from "../url-builder.ts";

function extractEsmShPackage(url: string): string | null {
  if (!isEsmShUrl(url)) return null;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.slice(1).replace(/^v\d+\//, "");

    if (pathname.startsWith("@")) {
      const pkg = pathname.split("/").slice(0, 2).join("/");
      return pkg.replace(/@[\d.]+.*$/, "") || null;
    }

    const pkg = (pathname.split("@")[0] ?? "").split("/")[0] ?? "";
    return pkg || null;
  } catch {
    return null;
  }
}

function extractEsmShSubpath(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.slice(1).replace(/^v\d+\//, "");

    if (pathname.startsWith("@")) {
      const parts = pathname.split("/");
      if (parts.length <= 2) return "";

      const packageParts = parts.slice(0, 2).join("/");
      const afterPackage = pathname.slice(packageParts.length);
      const versionMatch = afterPackage.match(/^@[^/]+(.*)$/);

      return versionMatch?.[1] ?? "";
    }

    const firstSlash = pathname.indexOf("/");
    if (firstSlash === -1) return "";

    const restPath = pathname.slice(firstSlash);
    return restPath.startsWith("/") ? restPath : "";
  } catch {
    return "";
  }
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
