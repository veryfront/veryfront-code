import type { ImportMapConfig } from "./types.ts";

function createStringRecord(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

function createScopeRecord(): Record<string, Record<string, string>> {
  return Object.create(null) as Record<string, Record<string, string>>;
}

export function mergeImportMaps(...maps: ImportMapConfig[]): ImportMapConfig {
  const imports = createStringRecord();
  const scopes = createScopeRecord();

  for (const map of maps) {
    if (map.imports) Object.assign(imports, map.imports);

    if (!map.scopes) continue;

    for (const [scope, scopeImports] of Object.entries(map.scopes)) {
      scopes[scope] ??= createStringRecord();
      Object.assign(scopes[scope], scopeImports);
    }
  }

  return { imports, scopes };
}
