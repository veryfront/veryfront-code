import type { ImportMapConfig } from "./types.ts";

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
