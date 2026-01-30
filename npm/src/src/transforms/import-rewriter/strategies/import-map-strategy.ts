/**
 * Import map resolution strategy.
 *
 * Priority: 5
 * Handles: SSR bare imports using import map, esm.sh URL remapping
 */

import type {
  ImportMapConfig,
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.js";
import { isEsmShUrl } from "../url-builder.js";

/**
 * Extract package name from esm.sh URL.
 */
function extractEsmShPackage(url: string): string | null {
  if (!isEsmShUrl(url)) return null;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.slice(1).replace(/^v\d+\//, "");

    const packageName = pathname.startsWith("@")
      ? pathname.split("/").slice(0, 2).join("/").replace(/@[\d.]+.*$/, "")
      : (pathname.split("@")[0] ?? "").split("/")[0] ?? "";

    return packageName || null;
  } catch {
    return null;
  }
}

/**
 * Extract subpath from esm.sh URL.
 */
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

/**
 * Resolve import using import map (follows WHATWG spec).
 */
export function resolveImportWithMap(
  specifier: string,
  importMap: ImportMapConfig,
  scope?: string,
): string | null {
  const scopedImports = scope ? importMap.scopes?.[scope] : undefined;

  // Check exact matches first (scoped, then global)
  const scopedExact = scopedImports?.[specifier];
  if (scopedExact) return scopedExact;

  const globalExact = importMap.imports?.[specifier];
  if (globalExact) return globalExact;

  // Handle esm.sh URLs - remap to import map entries
  if (isEsmShUrl(specifier)) {
    const esmShPackage = extractEsmShPackage(specifier);
    if (esmShPackage) {
      const subpath = extractEsmShSubpath(specifier);

      // Check for explicit subpath mapping first
      if (subpath) {
        const fullKey = esmShPackage + subpath;
        const subpathMapping = scopedImports?.[fullKey] ?? importMap.imports?.[fullKey];
        if (subpathMapping) return subpathMapping;
      }

      const mapping = scopedImports?.[esmShPackage] ?? importMap.imports?.[esmShPackage];
      if (mapping) {
        if (!subpath) return mapping;

        // If mapping is a file path, return base mapping
        const isFilePath = !mapping.startsWith("http://") &&
          !mapping.startsWith("https://") &&
          !mapping.startsWith("npm:");
        if (isFilePath) {
          return mapping;
        }

        return mapping + subpath;
      }
    }
  }

  // Handle .js/.mjs/.cjs extensions
  if (specifier.endsWith(".js") || specifier.endsWith(".mjs") || specifier.endsWith(".cjs")) {
    const base = specifier.replace(/\.(m|c)?js$/, "");
    const mapped = importMap.imports?.[base];
    if (mapped) return mapped;
  }

  // Prefix matching
  const imports = importMap.imports;
  if (imports) {
    for (const [key, value] of Object.entries(imports)) {
      if (key.endsWith("/") && specifier.startsWith(key)) {
        return value + specifier.slice(key.length);
      }
    }
  }

  return null;
}

export class ImportMapStrategy implements ImportRewriteStrategy {
  readonly name = "import-map";
  readonly priority = 5;

  matches(specifier: string, ctx: RewriteContext): boolean {
    // Only handle SSR transforms with import map available
    if (ctx.target !== "ssr") return false;
    if (!ctx.importMap) return false;

    // Handle bare specifiers and esm.sh URLs
    const isBare = !specifier.startsWith("http") &&
      !specifier.startsWith("/") &&
      !specifier.startsWith(".");

    return isBare || isEsmShUrl(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    if (!ctx.importMap) {
      return { specifier: null };
    }

    const resolved = resolveImportWithMap(info.specifier, ctx.importMap);
    if (resolved && resolved !== info.specifier) {
      return { specifier: resolved };
    }

    return { specifier: null };
  }
}

export const importMapStrategy = new ImportMapStrategy();
