import type { ImportMapConfig } from "./types.ts";

const ObjectAssign = Object.assign;
const ObjectEntries = Object.entries;
const ReflectApply = Reflect.apply;

function objectAssign<T extends object, U extends object>(target: T, source: U): T & U {
  return ReflectApply(ObjectAssign, Object, [target, source]) as T & U;
}

export function mergeImportMaps(...maps: ImportMapConfig[]): ImportMapConfig {
  const imports: Record<string, string> = {};
  const scopes: Record<string, Record<string, string>> = {};

  for (const map of maps) {
    if (map.imports) objectAssign(imports, map.imports);

    if (!map.scopes) continue;

    const scopeEntries = ObjectEntries(map.scopes);
    for (let index = 0; index < scopeEntries.length; index++) {
      const [scope, scopeImports] = scopeEntries[index]!;
      scopes[scope] ??= {};
      objectAssign(scopes[scope], scopeImports);
    }
  }

  return { imports, scopes };
}
