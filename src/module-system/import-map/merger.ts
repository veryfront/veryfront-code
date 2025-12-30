import type { ImportMapConfig } from "./types.ts";

export function mergeImportMaps(...maps: ImportMapConfig[]): ImportMapConfig {
  const imports: Record<string, string> = {};
  const scopes: Record<string, Record<string, string>> = {};

  for (const map of maps) {
    if (map.imports) {
      Object.assign(imports, map.imports);
    }

    if (map.scopes) {
      for (const [scope, scopeImports] of Object.entries(map.scopes)) {
        if (!scopes[scope]) {
          scopes[scope] = {};
        }
        Object.assign(scopes[scope], scopeImports);
      }
    }
  }

  return { imports, scopes };
}
