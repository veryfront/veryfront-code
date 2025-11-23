import type { ImportMapConfig } from "./types.ts";

export function mergeImportMaps(...maps: ImportMapConfig[]): ImportMapConfig {
  const merged: ImportMapConfig = {
    imports: {},
    scopes: {},
  };

  for (const map of maps) {
    if (map.imports) {
      Object.assign(merged.imports!, map.imports);
    }

    if (map.scopes) {
      for (const [scope, imports] of Object.entries(map.scopes)) {
        if (!merged.scopes![scope]) {
          merged.scopes![scope] = {};
        }
        Object.assign(merged.scopes![scope], imports);
      }
    }
  }

  return merged;
}
