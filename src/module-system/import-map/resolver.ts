import type { ImportMapConfig } from "./types.ts";

/**
 * Extract package name from esm.sh URL.
 * E.g., "https://esm.sh/@tanstack/react-query@5?external=react" -> "@tanstack/react-query"
 */
function extractEsmShPackage(url: string): string | null {
  if (!url.startsWith("https://esm.sh/") && !url.startsWith("http://esm.sh/")) {
    return null;
  }

  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname.slice(1); // Remove leading /

    // Remove version prefix like /v135/
    pathname = pathname.replace(/^v\d+\//, "");

    // Extract package name (before @version if present)
    // Handle scoped packages like @tanstack/react-query@5
    let packageName: string;
    if (pathname.startsWith("@")) {
      // Scoped package: @scope/name@version
      const parts = pathname.split("/");
      const scopedName = parts.slice(0, 2).join("/"); // @scope/name
      // Remove version suffix
      packageName = scopedName.replace(/@[\d.]+.*$/, "");
    } else {
      // Regular package: name@version
      const parts = pathname.split("@");
      packageName = (parts[0] ?? "").split("/")[0] ?? "";
    }

    return packageName || null;
  } catch {
    return null;
  }
}

export function resolveImport(
  specifier: string,
  importMap: ImportMapConfig,
  scope?: string,
): string {
  if (scope && importMap.scopes?.[scope]?.[specifier]) {
    return importMap.scopes[scope][specifier];
  }

  if (importMap.imports?.[specifier]) {
    return importMap.imports[specifier];
  }

  // Handle esm.sh URLs - extract package name and check import map
  const esmShPackage = extractEsmShPackage(specifier);
  if (esmShPackage && importMap.imports?.[esmShPackage]) {
    return importMap.imports[esmShPackage];
  }

  if (
    specifier.endsWith(".js") || specifier.endsWith(".mjs") ||
    specifier.endsWith(".cjs")
  ) {
    const base = specifier.replace(/\.(m|c)?js$/, "");
    if (importMap.imports?.[base]) {
      return importMap.imports[base];
    }
  }

  if (importMap.imports) {
    for (const [key, value] of Object.entries(importMap.imports)) {
      if (key.endsWith("/") && specifier.startsWith(key)) {
        return value + specifier.slice(key.length);
      }
    }
  }

  return specifier;
}
