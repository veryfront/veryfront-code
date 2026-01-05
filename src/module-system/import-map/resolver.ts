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

  // Handle esm.sh URLs - normalize package version but preserve subpath
  if (specifier.startsWith("https://esm.sh/") || specifier.startsWith("http://esm.sh/")) {
    const esmShPackage = extractEsmShPackage(specifier);
    if (esmShPackage && importMap.imports?.[esmShPackage]) {
      // Extract subpath from original URL
      const url = new URL(specifier);
      const pathname = url.pathname.slice(1).replace(/^v\d+\//, ""); // Remove leading / and version prefix

      // Find where the subpath starts (after package@version)
      let subpath = "";

      if (pathname.startsWith("@")) {
        // Scoped package: @scope/name@version or @scope/name@version/subpath
        const parts = pathname.split("/");
        if (parts.length > 2) {
          // @scope/name@version/subpath - has more than scope/name
          const packageParts = parts.slice(0, 2).join("/"); // @scope/name
          const afterPackage = pathname.slice(packageParts.length);
          // Remove version suffix to get subpath
          // afterPackage is like "@5/subpath" or "@5.1.0/subpath/file"
          const versionMatch = afterPackage.match(/^@[^/]+(.*)$/);
          subpath = versionMatch?.[1] ?? "";
        }
        // If parts.length <= 2, it's just @scope/name@version with no subpath
      } else {
        // Non-scoped package: name@version or name@version/subpath
        if (pathname.includes("/")) {
          // Has a subpath: name@version/subpath
          const packageWithVersion = pathname.split("/")[0];
          const restPath = pathname.slice(packageWithVersion!.length);
          if (restPath.startsWith("/")) {
            subpath = restPath;
          }
        }
      }

      // Return mapped URL with preserved subpath
      const mappedUrl = importMap.imports[esmShPackage];
      return subpath ? mappedUrl + subpath : mappedUrl;
    }
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
