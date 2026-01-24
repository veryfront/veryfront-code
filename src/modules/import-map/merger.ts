import type { ImportMapConfig } from "./types.ts";

export function mergeImportMaps(...maps: ImportMapConfig[]): ImportMapConfig {
  const imports: Record<string, string> = {};
  const scopes: Record<string, Record<string, string>> = {};

  for (const { imports: mapImports, scopes: mapScopes } of maps) {
    if (mapImports) Object.assign(imports, mapImports);

    if (!mapScopes) continue;

    for (const [scope, scopeImports] of Object.entries(mapScopes)) {
      scopes[scope] ??= {};
      Object.assign(scopes[scope], scopeImports);
    }
  }

  return { imports, scopes };
}
