import { snapshotImportMap } from "#veryfront/transforms/pipeline/cache-identity.ts";
import type { ImportMapConfig } from "./types.ts";

// Import maps can be merged after project code has executed in this realm.
// Capture the small set of primitives used here and only read validated,
// descriptor-snapshotted records.
const ObjectCreate = Object.create;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const IntrinsicTypeError = TypeError;

function hasOwn(descriptor: PropertyDescriptor, key: PropertyKey): boolean {
  return ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, [key]) as boolean;
}

function copySnapshotField(
  input: ImportMapConfig,
  map: ImportMapConfig,
  key: "imports" | "scopes",
): void {
  const descriptor = ObjectGetOwnPropertyDescriptor(map, key);
  if (!descriptor) return;
  if (!hasOwn(descriptor, "value")) {
    throw new IntrinsicTypeError(`Import map ${key} cannot contain accessor properties`);
  }
  input[key] = descriptor.value;
}

function snapshotMergeInput(map: ImportMapConfig): ImportMapConfig {
  const input = ObjectCreate(null) as ImportMapConfig;
  copySnapshotField(input, map, "imports");
  copySnapshotField(input, map, "scopes");
  return snapshotImportMap(input);
}

function copyStringRecord(
  target: Record<string, string>,
  source: Readonly<Record<string, string>>,
): void {
  const keys = ReflectOwnKeys(source);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (typeof key !== "string") continue;
    const descriptor = ObjectGetOwnPropertyDescriptor(source, key);
    if (descriptor?.enumerable && hasOwn(descriptor, "value")) {
      target[key] = descriptor.value as string;
    }
  }
}

export function mergeImportMaps(...maps: ImportMapConfig[]): ImportMapConfig {
  const imports = ObjectCreate(null) as Record<string, string>;
  const scopes = ObjectCreate(null) as Record<string, Record<string, string>>;

  for (let index = 0; index < maps.length; index++) {
    const map = snapshotMergeInput(maps[index]!);
    copyStringRecord(imports, map.imports ?? ObjectCreate(null));

    const mapScopes = map.scopes ?? ObjectCreate(null);
    const scopeKeys = ReflectOwnKeys(mapScopes);
    for (let scopeIndex = 0; scopeIndex < scopeKeys.length; scopeIndex++) {
      const scope = scopeKeys[scopeIndex];
      if (typeof scope !== "string") continue;
      const descriptor = ObjectGetOwnPropertyDescriptor(mapScopes, scope);
      if (!descriptor?.enumerable || !hasOwn(descriptor, "value")) continue;
      const target = scopes[scope] ??= ObjectCreate(null) as Record<string, string>;
      copyStringRecord(target, descriptor.value as Readonly<Record<string, string>>);
    }
  }

  return snapshotImportMap({ imports, scopes });
}
