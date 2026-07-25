import type { ImportMapConfig } from "./types.ts";

const ObjectAssign = Object.assign;
const ObjectCreate = Object.create;
const ObjectEntries = Object.entries;
const ReflectApply = Reflect.apply;

function createStringRecord(): Record<string, string> {
  return ObjectCreate(null) as Record<string, string>;
}

function createScopeRecord(): Record<string, Record<string, string>> {
  return ObjectCreate(null) as Record<string, Record<string, string>>;
}

function assignRecord<T extends object>(target: T, source: object): T {
  return ReflectApply(ObjectAssign, Object, [target, source]) as T;
}

export function mergeImportMaps(...maps: ImportMapConfig[]): ImportMapConfig {
  const imports = createStringRecord();
  const scopes = createScopeRecord();

  for (let mapIndex = 0; mapIndex < maps.length; mapIndex++) {
    const map = maps[mapIndex]!;
    if (map.imports) assignRecord(imports, map.imports);

    if (!map.scopes) continue;

    const scopeEntries = ObjectEntries(map.scopes);
    for (let scopeIndex = 0; scopeIndex < scopeEntries.length; scopeIndex++) {
      const entry = scopeEntries[scopeIndex]!;
      const scope = entry[0];
      const scopeImports = entry[1];
      scopes[scope] ??= createStringRecord();
      assignRecord(scopes[scope], scopeImports);
    }
  }

  return { imports, scopes };
}
