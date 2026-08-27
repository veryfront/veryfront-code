import { getConfig, type VeryfrontConfig } from "#veryfront/config";
import { IMPORT_MAP_INVALID, isVeryfrontError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { snapshotImportMap } from "#veryfront/transforms/pipeline/cache-identity.ts";
import { getReactImportMap } from "#veryfront/transforms/esm/react-cdn.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { getDefaultImportMap } from "./default-import-map.ts";
import { mergeImportMaps } from "./merger.ts";
import type { ImportMapConfig } from "./types.ts";

// A hosted project can execute in this realm before a later request loads its
// import map. Capture the primitives and framework-owned maps used to select
// executable modules so replacing shared globals cannot redirect resolution.
const JSONParse = JSON.parse;
const ArrayIsArray = Array.isArray;
const ObjectCreate = Object.create;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ObjectPrototype = Object.prototype;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeStartsWith = String.prototype.startsWith;

const DEFAULT_IMPORT_MAP = snapshotImportMap(getDefaultImportMap());
const REACT_IMPORTS = snapshotImportMap({ imports: getReactImportMap() }).imports!;

function stringStartsWith(value: string, prefix: string): boolean {
  return ReflectApply(StringPrototypeStartsWith, value, [prefix]) as boolean;
}

function stringSlice(value: string, start: number, end?: number): string {
  return ReflectApply(
    StringPrototypeSlice,
    value,
    end === undefined ? [start] : [start, end],
  ) as string;
}

function hasOwn(descriptor: PropertyDescriptor, key: PropertyKey): boolean {
  return ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, [key]) as boolean;
}

/** @internal Whether a project mapping targets a framework-owned specifier. */
export function isFrameworkOwnedImportMapSpecifier(specifier: string): boolean {
  return specifier === "react" || specifier === "react-dom" ||
    stringStartsWith(specifier, "react/") ||
    stringStartsWith(specifier, "react-dom/") ||
    stringStartsWith(specifier, "veryfront/");
}

function removeFrameworkOwnedMappings(record: Record<string, string>): void {
  const keys = ReflectOwnKeys(record);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (typeof key === "string" && isFrameworkOwnedImportMapSpecifier(key)) {
      delete record[key];
    }
  }
}

function readOwnDataProperty(
  value: Record<string, unknown>,
  key: PropertyKey,
  label: string,
): unknown {
  const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) {
    throw IMPORT_MAP_INVALID.create({
      detail: `${label} cannot contain accessor properties`,
    });
  }
  return descriptor.value;
}

function assertPlainObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || ArrayIsArray(value)) {
    throw IMPORT_MAP_INVALID.create({ detail: `${label} must be a plain object` });
  }
  const prototype = ObjectGetPrototypeOf(value);
  if (prototype !== ObjectPrototype && prototype !== null) {
    throw IMPORT_MAP_INVALID.create({ detail: `${label} must be a plain object` });
  }
}

function readEmbeddedImportMap(
  container: unknown,
  label: string,
): ImportMapConfig | null {
  assertPlainObject(container, label);
  const imports = readOwnDataProperty(container, "imports", label);
  const scopes = readOwnDataProperty(container, "scopes", label);
  if (imports === undefined && scopes === undefined) return null;
  return snapshotImportMap({
    imports: imports ?? ObjectCreate(null),
    scopes: scopes ?? ObjectCreate(null),
  });
}

function copyFilteredRecord(
  record: Readonly<Record<string, string>>,
  normalizeNpm: boolean,
): Record<string, string> {
  const result = ObjectCreate(null) as Record<string, string>;
  const keys = ReflectOwnKeys(record);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (typeof key !== "string") continue;
    const descriptor = ObjectGetOwnPropertyDescriptor(record, key);
    if (!descriptor?.enumerable || !hasOwn(descriptor, "value")) continue;
    const value = descriptor.value as string;
    if (stringStartsWith(value, "./") || stringStartsWith(value, "../")) continue;
    result[key] = normalizeNpm ? normalizeImportValue(value) : value;
  }
  return result;
}

function filterRelativePaths(importMap: ImportMapConfig): ImportMapConfig {
  const exact = snapshotImportMap(importMap);
  const imports = copyFilteredRecord(exact.imports ?? ObjectCreate(null), false);
  const scopes = ObjectCreate(null) as Record<string, Record<string, string>>;
  const exactScopes = exact.scopes ?? ObjectCreate(null);
  const scopeKeys = ReflectOwnKeys(exactScopes);
  for (let index = 0; index < scopeKeys.length; index++) {
    const scope = scopeKeys[index];
    if (typeof scope !== "string") continue;
    const descriptor = ObjectGetOwnPropertyDescriptor(exactScopes, scope);
    if (!descriptor?.enumerable || !hasOwn(descriptor, "value")) continue;
    scopes[scope] = copyFilteredRecord(
      descriptor.value as Readonly<Record<string, string>>,
      false,
    );
  }
  return snapshotImportMap({ imports, scopes });
}

function normalizeImportValue(value: string): string {
  if (!stringStartsWith(value, "npm:")) return value;
  const specifier = stringSlice(value, 4);
  const queryIndex = ReflectApply(StringPrototypeIndexOf, specifier, ["?"]) as number;
  const base = queryIndex < 0 ? specifier : stringSlice(specifier, 0, queryIndex);
  const query = queryIndex < 0 ? "" : stringSlice(specifier, queryIndex + 1);
  const url = `https://esm.sh/${base}`;
  return query ? `${url}?${query}` : `${url}?target=es2022`;
}

/** @internal Apply the authoritative runtime import-map policy to a merged map. */
export function normalizeImportMapForRuntime(importMap: ImportMapConfig): ImportMapConfig {
  const exact = snapshotImportMap(importMap);
  const imports = copyFilteredRecord(exact.imports ?? ObjectCreate(null), true);
  const scopes = ObjectCreate(null) as Record<string, Record<string, string>>;
  const exactScopes = exact.scopes ?? ObjectCreate(null);
  const scopeKeys = ReflectOwnKeys(exactScopes);
  for (let index = 0; index < scopeKeys.length; index++) {
    const scope = scopeKeys[index];
    if (typeof scope !== "string") continue;
    const descriptor = ObjectGetOwnPropertyDescriptor(exactScopes, scope);
    if (!descriptor?.enumerable || !hasOwn(descriptor, "value")) continue;
    scopes[scope] = copyFilteredRecord(
      descriptor.value as Readonly<Record<string, string>>,
      true,
    );
    removeFrameworkOwnedMappings(scopes[scope]);
  }

  // Framework and React mappings are authoritative, guaranteeing one React
  // instance and preventing exact, prefix, or scoped project overrides from
  // redirecting core code.
  removeFrameworkOwnedMappings(imports);
  const defaultImports = DEFAULT_IMPORT_MAP.imports ?? ObjectCreate(null);
  const defaultKeys = ReflectOwnKeys(defaultImports);
  for (let index = 0; index < defaultKeys.length; index++) {
    const key = defaultKeys[index];
    if (typeof key !== "string" || !stringStartsWith(key, "veryfront/")) continue;
    const descriptor = ObjectGetOwnPropertyDescriptor(defaultImports, key);
    if (descriptor?.enumerable && hasOwn(descriptor, "value")) {
      imports[key] = descriptor.value as string;
    }
  }
  const reactKeys = ReflectOwnKeys(REACT_IMPORTS);
  for (let index = 0; index < reactKeys.length; index++) {
    const key = reactKeys[index];
    if (typeof key !== "string") continue;
    const descriptor = ObjectGetOwnPropertyDescriptor(REACT_IMPORTS, key);
    if (descriptor?.enumerable && hasOwn(descriptor, "value")) {
      imports[key] = descriptor.value as string;
    }
  }
  return snapshotImportMap({ imports, scopes });
}

async function getRuntimeAdapter(adapter?: RuntimeAdapter): Promise<RuntimeAdapter> {
  if (adapter) return adapter;
  const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
  return runtime.get();
}

async function loadDenoJsonImportMap(
  startPath: string,
  adapter: RuntimeAdapter,
): Promise<ImportMapConfig | null> {
  const readMap = async (path: string): Promise<ImportMapConfig | null> => {
    const content = await adapter.fs.readFile(path);
    const parsed = ReflectApply(JSONParse, JSON, [content]) as unknown;
    const map = readEmbeddedImportMap(parsed, "deno.json");
    return map ? filterRelativePaths(map) : null;
  };

  if (isVirtualFilesystem(adapter.fs)) {
    try {
      const map = await readMap("deno.json");
      if (map) logger.debug("Loaded import map from deno.json (virtual filesystem)");
      return map;
    } catch (_) {
      return null;
    }
  }

  let currentPath = startPath;
  while (currentPath !== "/" && currentPath !== "") {
    const denoJsonPath = join(currentPath, "deno.json");
    try {
      const map = await readMap(denoJsonPath);
      if (map) {
        logger.debug(`Loaded import map from ${denoJsonPath}`);
        return map;
      }
    } catch (_) {
      // A missing or invalid deno.json does not override framework defaults.
    }
    const parent = dirname(currentPath);
    if (parent === currentPath) break;
    currentPath = parent;
  }
  return null;
}

function getConfigImportMap(config: VeryfrontConfig): ImportMapConfig | null {
  try {
    assertPlainObject(config, "Veryfront config");
    const resolve = readOwnDataProperty(config, "resolve", "Veryfront config");
    if (resolve === undefined) return null;
    assertPlainObject(resolve, "Veryfront config resolve");
    const importMap = readOwnDataProperty(
      resolve,
      "importMap",
      "Veryfront config resolve",
    );
    if (importMap === undefined || importMap === null) return null;
    const embedded = readEmbeddedImportMap(
      importMap,
      "Veryfront config resolve importMap",
    );
    return embedded ?? snapshotImportMap({});
  } catch (error) {
    if (isVeryfrontError(error)) throw error;
    throw IMPORT_MAP_INVALID.create({
      detail: "Veryfront config resolve importMap is invalid",
    });
  }
}

export function loadImportMap(
  startPath: string,
  adapter?: RuntimeAdapter,
  config?: VeryfrontConfig,
): Promise<ImportMapConfig> {
  return withSpan(
    "modules.importMap.load",
    async () => {
      const runtimeAdapter = await getRuntimeAdapter(adapter);
      const denoJsonMap = await loadDenoJsonImportMap(startPath, runtimeAdapter);
      let configMap: ImportMapConfig | null = null;
      if (config) {
        configMap = getConfigImportMap(config);
      } else {
        try {
          const loadedConfig = await getConfig(startPath, runtimeAdapter);
          if (loadedConfig) configMap = getConfigImportMap(loadedConfig);
        } catch (_) {
          // A missing or invalid optional config does not override safe defaults.
        }
      }

      const merged = mergeImportMaps(
        DEFAULT_IMPORT_MAP,
        denoJsonMap ?? { imports: {}, scopes: {} },
        configMap ?? { imports: {}, scopes: {} },
      );
      return normalizeImportMapForRuntime(merged);
    },
    { "importMap.startPath": startPath },
  );
}
