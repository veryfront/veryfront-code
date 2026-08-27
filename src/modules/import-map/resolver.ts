import type { ImportMapConfig } from "./types.ts";
import { resolveEsmShThroughImportMap } from "#veryfront/transforms/shared/esm-sh-import-map.ts";

export function resolveImport(
  specifier: string,
  importMap: ImportMapConfig,
  scope?: string,
): string {
  const scopedImports = scope ? importMap.scopes?.[scope] : undefined;

  const scopedExact = scopedImports?.[specifier];
  if (scopedExact) return scopedExact;

  const esmShMapping = resolveEsmShThroughImportMap(
    specifier,
    scopedImports,
    undefined,
  );
  if (esmShMapping) return esmShMapping;

  const globalExact = importMap.imports?.[specifier];
  if (globalExact) return globalExact;

  const globalEsmShMapping = resolveEsmShThroughImportMap(
    specifier,
    undefined,
    importMap.imports,
  );
  if (globalEsmShMapping) return globalEsmShMapping;

  if (specifier.endsWith(".js") || specifier.endsWith(".mjs") || specifier.endsWith(".cjs")) {
    const base = specifier.replace(/\.(m|c)?js$/, "");
    const mapped = importMap.imports?.[base];
    if (mapped) return mapped;
  }

  let prefixMatch: { key: string; value: string } | undefined;
  for (const [key, value] of Object.entries(importMap.imports ?? {})) {
    if (
      key.endsWith("/") && specifier.startsWith(key) &&
      (prefixMatch === undefined || key.length > prefixMatch.key.length)
    ) {
      prefixMatch = { key, value };
    }
  }
  if (prefixMatch !== undefined) {
    return prefixMatch.value + specifier.slice(prefixMatch.key.length);
  }

  return specifier;
}
