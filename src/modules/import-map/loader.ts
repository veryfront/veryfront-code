import { rendererLogger as logger } from "#veryfront/utils";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getConfig, type VeryfrontConfig } from "#veryfront/config";
import type { ImportMapConfig } from "./types.ts";
import { getDefaultImportMap } from "./default-import-map.ts";
import { mergeImportMaps } from "./merger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { getReactImportMap } from "#veryfront/transforms/esm/react-cdn.ts";

// Import-map loading runs after project code may have executed in the same
// realm. Capture normalization/parsing primitives and the framework-owned maps
// before that code can replace shared built-ins.
const ArrayIsArray = Array.isArray;
const IntrinsicTypeError = TypeError;
const JSONParse = JSON.parse;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectEntries = Object.entries;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ReflectApply = Reflect.apply;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeSplit = String.prototype.split;
const StringPrototypeStartsWith = String.prototype.startsWith;
const trustedDefaultImportMap = getDefaultImportMap();
const trustedReactImportMap = getReactImportMap();

function objectEntries<T>(value: Record<string, T>): Array<[string, T]> {
  return ObjectEntries(value) as Array<[string, T]>;
}

function createRecord<T>(): Record<string, T> {
  return ObjectCreate(null) as Record<string, T>;
}

function defineRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  ReflectApply(ObjectDefineProperty, Object, [
    record,
    key,
    {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    },
  ]);
}

function readOwnDataProperty(
  value: object,
  key: string,
  label: string,
): PropertyDescriptor | undefined {
  const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
  if (descriptor?.get || descriptor?.set) {
    throw new IntrinsicTypeError(`${label}.${key} cannot be an accessor`);
  }
  return descriptor;
}

function stringSlice(value: string, start: number): string {
  return ReflectApply(StringPrototypeSlice, value, [start]) as string;
}

function stringSplit(value: string, separator: string): string[] {
  return ReflectApply(StringPrototypeSplit, value, [separator]) as string[];
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeStartsWith, value, [search]) as boolean;
}

function normalizeImportMapForRuntime(importMap: ImportMapConfig): ImportMapConfig {
  const normalizeValue = (value: string): string => {
    if (!stringStartsWith(value, "npm:")) return value;

    // Convert npm: specifiers to esm.sh URLs (should not happen with new code)
    const spec = stringSlice(value, 4);
    const parts = stringSplit(spec, "?");
    const base = parts[0]!;
    const query = parts[1];
    const url = `https://esm.sh/${base}`;

    return query ? `${url}?${query}` : `${url}?target=es2022`;
  };

  const imports = importMap.imports ? createRecord<string>() : undefined;
  if (imports && importMap.imports) {
    const entries = objectEntries(importMap.imports);
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      defineRecordValue(imports, entry[0], normalizeValue(entry[1]));
    }
  }

  const scopes = importMap.scopes ? createRecord<Record<string, string>>() : undefined;
  if (scopes && importMap.scopes) {
    const scopeEntries = objectEntries(importMap.scopes);
    for (let scopeIndex = 0; scopeIndex < scopeEntries.length; scopeIndex++) {
      const scopeEntry = scopeEntries[scopeIndex]!;
      const mappings = createRecord<string>();
      const mappingEntries = objectEntries(scopeEntry[1]);
      for (
        let mappingIndex = 0;
        mappingIndex < mappingEntries.length;
        mappingIndex++
      ) {
        const mapping = mappingEntries[mappingIndex]!;
        defineRecordValue(mappings, mapping[0], normalizeValue(mapping[1]));
      }
      defineRecordValue(scopes, scopeEntry[0], mappings);
    }
  }

  // Override React mappings AFTER all other processing to ensure single instance.
  // Remove any "react/" prefix match since we have explicit mappings.
  if (imports) {
    delete imports["react/"];
    const defaultEntries = objectEntries(trustedDefaultImportMap.imports ?? {});
    for (let index = 0; index < defaultEntries.length; index++) {
      const entry = defaultEntries[index]!;
      if (stringStartsWith(entry[0], "veryfront/")) {
        defineRecordValue(imports, entry[0], entry[1]);
      }
    }
    const reactEntries = objectEntries(trustedReactImportMap);
    for (let index = 0; index < reactEntries.length; index++) {
      const entry = reactEntries[index]!;
      defineRecordValue(imports, entry[0], entry[1]);
    }
  }

  return { imports, scopes };
}

async function getRuntimeAdapter(adapter?: RuntimeAdapter): Promise<RuntimeAdapter> {
  if (adapter) return adapter;

  const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
  return runtime.get();
}

/**
 * Filter out relative paths from import map entries.
 *
 * Relative paths (./foo, ../bar) in deno.json are for Deno's native module resolution.
 * They can't work in the browser/SSR context where we serve modules via /_vf_modules/.
 * The default import map has correct absolute paths like /_vf_modules/_veryfront/...
 */
function filterRelativePaths(imports: Record<string, string>): Record<string, string> {
  const filtered = createRecord<string>();
  const entries = objectEntries(imports);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (
      !stringStartsWith(entry[1], "./") &&
      !stringStartsWith(entry[1], "../")
    ) {
      defineRecordValue(filtered, entry[0], entry[1]);
    }
  }
  return filtered;
}

function parseStringMappings(
  value: unknown,
  label: string,
): Record<string, string> {
  if (value === null || typeof value !== "object" || ArrayIsArray(value)) {
    throw new IntrinsicTypeError(`${label} must be an object of string mappings`);
  }

  // JSON allows "__proto__" as a real specifier. A normal object assignment
  // would invoke Object.prototype's legacy setter and silently drop it.
  const mappings = createRecord<string>();
  const entries = objectEntries(value as Record<string, unknown>);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const specifier = entry[0];
    const target = entry[1];
    if (typeof target !== "string") {
      throw new IntrinsicTypeError(`${label}.${specifier} must be a string`);
    }
    defineRecordValue(mappings, specifier, target);
  }
  return mappings;
}

function parseDenoJsonImportMap(
  content: string,
  source: string,
): ImportMapConfig | null {
  const parsed: unknown = ReflectApply(JSONParse, undefined, [content]);
  if (parsed === null || typeof parsed !== "object" || ArrayIsArray(parsed)) {
    throw new IntrinsicTypeError(`${source} must contain a JSON object`);
  }

  const config = parsed as Record<string, unknown>;
  const importsDescriptor = readOwnDataProperty(config, "imports", source);
  const scopesDescriptor = readOwnDataProperty(config, "scopes", source);
  const hasImports = importsDescriptor !== undefined;
  const hasScopes = scopesDescriptor !== undefined;
  if (!hasImports && !hasScopes) return null;

  const imports = hasImports
    ? filterRelativePaths(
      parseStringMappings(importsDescriptor?.value, `${source}.imports`),
    )
    : createRecord<string>();
  const scopes = createRecord<Record<string, string>>();
  if (hasScopes) {
    const rawScopes = scopesDescriptor?.value;
    if (
      rawScopes === null || typeof rawScopes !== "object" ||
      ArrayIsArray(rawScopes)
    ) {
      throw new IntrinsicTypeError(`${source}.scopes must be an object of import maps`);
    }
    const scopeEntries = objectEntries(rawScopes as Record<string, unknown>);
    for (let index = 0; index < scopeEntries.length; index++) {
      const entry = scopeEntries[index]!;
      defineRecordValue(
        scopes,
        entry[0],
        filterRelativePaths(
          parseStringMappings(entry[1], `${source}.scopes.${entry[0]}`),
        ),
      );
    }
  }

  return { imports, scopes };
}

async function loadDenoJsonImportMap(
  startPath: string,
  adapter: RuntimeAdapter,
): Promise<ImportMapConfig | null> {
  // For virtual filesystems (API-backed), only check project root
  // Virtual filesystems use relative paths, not absolute local paths
  if (isVirtualFilesystem(adapter.fs)) {
    let content: string;
    try {
      content = await adapter.fs.readFile("deno.json");
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
    const importMap = parseDenoJsonImportMap(content, "deno.json");
    if (importMap) {
      logger.debug("Loaded import map from deno.json (virtual filesystem)");
    }
    return importMap;
  }

  // For local filesystems, walk up directory tree
  let currentPath = startPath;

  while (currentPath !== "/" && currentPath !== "") {
    const denoJsonPath = join(currentPath, "deno.json");

    let content: string;
    try {
      content = await adapter.fs.readFile(denoJsonPath);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      const parent = dirname(currentPath);
      if (parent === currentPath) break;
      currentPath = parent;
      continue;
    }

    const importMap = parseDenoJsonImportMap(content, denoJsonPath);
    if (importMap) {
      logger.debug(`Loaded import map from ${denoJsonPath}`);
      return importMap;
    }

    const parent = dirname(currentPath);
    if (parent === currentPath) break;
    currentPath = parent;
  }

  return null;
}

function getConfigImportMap(config: VeryfrontConfig): ImportMapConfig | null {
  const importMap = config.resolve?.importMap;
  if (!importMap) return null;

  return {
    imports: importMap.imports ?? {},
    scopes: importMap.scopes ?? {},
  };
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

      // First, load import map from deno.json (if exists)
      const denoJsonMap = await loadDenoJsonImportMap(startPath, runtimeAdapter);

      // Then, try to get config's import map
      let configMap: ImportMapConfig | null = null;
      if (config) {
        configMap = getConfigImportMap(config);
      } else {
        // getConfig already distinguishes an absent file (validated defaults)
        // from a present malformed/invalid file (rejection). Never turn an
        // operational or validation failure into a different dependency graph.
        configMap = getConfigImportMap(await getConfig(startPath, runtimeAdapter));
      }

      // Merge: defaults < deno.json < config
      // If both deno.json and config have import maps, config takes precedence for overlapping keys
      // but deno.json's unique keys (especially scopes) are preserved
      const merged = mergeImportMaps(
        trustedDefaultImportMap,
        denoJsonMap ?? { imports: {}, scopes: {} },
        configMap ?? { imports: {}, scopes: {} },
      );

      return normalizeImportMapForRuntime(merged);
    },
    { "importMap.startPath": startPath },
  );
}
