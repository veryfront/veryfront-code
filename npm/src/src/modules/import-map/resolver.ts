import type { ImportMapConfig } from "./types.js";

/** Check if URL is an esm.sh URL */
function isEsmShUrl(url: string): boolean {
  return url.startsWith("https://esm.sh/") || url.startsWith("http://esm.sh/");
}

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

function extractEsmShSubpath(url: string): string {
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
}

export function resolveImport(
  specifier: string,
  importMap: ImportMapConfig,
  scope?: string,
): string {
  const scopedImports = scope ? importMap.scopes?.[scope] : undefined;

  const scopedExact = scopedImports?.[specifier];
  if (scopedExact) return scopedExact;

  const globalExact = importMap.imports?.[specifier];
  if (globalExact) return globalExact;

  if (isEsmShUrl(specifier)) {
    const esmShPackage = extractEsmShPackage(specifier);
    if (esmShPackage) {
      const subpath = extractEsmShSubpath(specifier);

      // Always check for explicit subpath mapping first (e.g., "react/jsx-runtime")
      // This takes priority over appending subpath to base package mapping
      if (subpath) {
        const fullKey = esmShPackage + subpath; // e.g., "react/jsx-runtime"
        const subpathMapping = scopedImports?.[fullKey] ?? importMap.imports?.[fullKey];
        if (subpathMapping) return subpathMapping;
      }

      const mapping = scopedImports?.[esmShPackage] ?? importMap.imports?.[esmShPackage];
      if (mapping) {
        if (!subpath) return mapping;

        // If mapping target is a file path (not HTTP URL or npm: specifier),
        // fall back to base mapping since explicit subpath wasn't found above
        const isFilePath = !mapping.startsWith("http://") && !mapping.startsWith("https://") &&
          !mapping.startsWith("npm:");
        if (isFilePath) {
          return mapping;
        }

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
  if (imports) {
    for (const [key, value] of Object.entries(imports)) {
      if (key.endsWith("/") && specifier.startsWith(key)) {
        return value + specifier.slice(key.length);
      }
    }
  }

  return specifier;
}
