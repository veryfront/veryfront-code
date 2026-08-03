import { rendererLogger as logger } from "#veryfront/utils";
import { dirname } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getConfig, type VeryfrontConfig } from "#veryfront/config";
import type { ImportMapConfig } from "./types.ts";
import { getDefaultImportMap } from "./default-import-map.ts";
import { mergeImportMaps } from "./merger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getReactImportMap } from "#veryfront/transforms/esm/react-cdn.ts";

const ArrayPrototypePush = Array.prototype.push;
const JSONParse = JSON.parse;
const ObjectEntries = Object.entries;
const ObjectFromEntries = Object.fromEntries;
const ReflectApply = Reflect.apply;

function arrayPush<T>(values: T[], value: T): void {
  ReflectApply(ArrayPrototypePush, values, [value]);
}

function objectFromEntries<T>(entries: Array<[string, T]>): Record<string, T> {
  return ReflectApply(ObjectFromEntries, Object, [entries]) as Record<string, T>;
}

function normalizeImportMapForRuntime(importMap: ImportMapConfig): ImportMapConfig {
  const normalizeValue = (value: string): string => {
    if (!value.startsWith("npm:")) return value;

    // Convert npm: specifiers to esm.sh URLs (should not happen with new code)
    const spec = value.slice(4);
    const [base, query] = spec.split("?");
    const url = `https://esm.sh/${base}`;

    return query ? `${url}?${query}` : `${url}?target=es2022`;
  };

  let imports: Record<string, string> | undefined;
  if (importMap.imports) {
    const normalizedImports: Array<[string, string]> = [];
    const importEntries = ObjectEntries(importMap.imports);
    for (let index = 0; index < importEntries.length; index++) {
      const [key, value] = importEntries[index]!;
      arrayPush(normalizedImports, [key, normalizeValue(value)]);
    }
    imports = objectFromEntries(normalizedImports);
  }

  let scopes: Record<string, Record<string, string>> | undefined;
  if (importMap.scopes) {
    const normalizedScopes: Array<[string, Record<string, string>]> = [];
    const scopeEntries = ObjectEntries(importMap.scopes);
    for (let scopeIndex = 0; scopeIndex < scopeEntries.length; scopeIndex++) {
      const [scope, mappings] = scopeEntries[scopeIndex]!;
      const normalizedMappings: Array<[string, string]> = [];
      const mappingEntries = ObjectEntries(mappings);
      for (let mappingIndex = 0; mappingIndex < mappingEntries.length; mappingIndex++) {
        const [key, value] = mappingEntries[mappingIndex]!;
        arrayPush(normalizedMappings, [key, normalizeValue(value)]);
      }
      arrayPush(normalizedScopes, [scope, objectFromEntries(normalizedMappings)]);
    }
    scopes = objectFromEntries(normalizedScopes);
  }

  // Override React mappings AFTER all other processing to ensure single instance.
  // Remove any "react/" prefix match since we have explicit mappings.
  if (imports) {
    const veryfrontEntries: Array<[string, string]> = [];
    const defaultEntries = ObjectEntries(getDefaultImportMap().imports ?? {});
    for (let index = 0; index < defaultEntries.length; index++) {
      const [key, value] = defaultEntries[index]!;
      if (key.startsWith("veryfront/")) arrayPush(veryfrontEntries, [key, value]);
    }
    const veryfrontSsrMap = objectFromEntries(veryfrontEntries);
    const reactMap = getReactImportMap();
    delete imports["react/"];
    imports = { ...imports, ...veryfrontSsrMap, ...reactMap };
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
  const filtered: Array<[string, string]> = [];
  const entries = ObjectEntries(imports);
  for (let index = 0; index < entries.length; index++) {
    const [key, value] = entries[index]!;
    if (!value.startsWith("./") && !value.startsWith("../")) {
      arrayPush(filtered, [key, value]);
    }
  }
  return objectFromEntries(filtered);
}

async function loadDenoJsonImportMap(
  startPath: string,
  adapter: RuntimeAdapter,
): Promise<ImportMapConfig | null> {
  // For virtual filesystems (API-backed), only check project root
  // Virtual filesystems use relative paths, not absolute local paths
  if (isVirtualFilesystem(adapter.fs)) {
    try {
      const content = await adapter.fs.readFile("deno.json");
      const config = JSONParse(content);

      if (config.imports || config.scopes) {
        logger.debug("Loaded import map from deno.json (virtual filesystem)");
        const imports = config.imports ? filterRelativePaths(config.imports) : {};
        const scopes = config.scopes ? filterScopeRelativePaths(config.scopes) : {};
        return { imports, scopes };
      }
    } catch (_) {
      /* expected: deno.json not found in virtual filesystem */
    }
    return null;
  }

  // For local filesystems, walk up directory tree
  let currentPath = startPath;

  while (currentPath !== "/" && currentPath !== "") {
    const denoJsonPath = currentPath === "/" ? "/deno.json" : `${currentPath}/deno.json`;

    try {
      const content = await adapter.fs.readFile(denoJsonPath);
      const config = JSONParse(content);

      if (config.imports || config.scopes) {
        logger.debug(`Loaded import map from ${denoJsonPath}`);
        const imports = config.imports ? filterRelativePaths(config.imports) : {};
        const scopes = config.scopes ? filterScopeRelativePaths(config.scopes) : {};
        return { imports, scopes };
      }
    } catch (_) {
      /* expected: deno.json not found in this directory, continue searching */
    }

    const parent = dirname(currentPath);
    if (parent === currentPath) break;
    currentPath = parent;
  }

  return null;
}

function filterScopeRelativePaths(
  scopes: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  const filteredScopes: Array<[string, Record<string, string>]> = [];
  const scopeEntries = ObjectEntries(scopes);
  for (let index = 0; index < scopeEntries.length; index++) {
    const [scope, mappings] = scopeEntries[index]!;
    arrayPush(filteredScopes, [scope, filterRelativePaths(mappings)]);
  }
  return objectFromEntries(filteredScopes);
}

function getConfigImportMap(config: VeryfrontConfig): ImportMapConfig | null {
  const importMap = config.resolve?.importMap;
  if (!importMap || typeof importMap !== "object") return null;

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

      // Then, try to get config's import map. A config already validated for
      // the authenticated request takes precedence over re-reading it from the
      // project source.
      let configMap: ImportMapConfig | null = null;
      if (config) {
        configMap = getConfigImportMap(config);
      } else {
        try {
          const cfg = await getConfig(startPath, runtimeAdapter);
          if (cfg) configMap = getConfigImportMap(cfg);
        } catch (_) {
          /* expected: config not found or invalid, continue without it */
        }
      }

      // Merge: defaults < deno.json < config
      // If both deno.json and config have import maps, config takes precedence for overlapping keys
      // but deno.json's unique keys (especially scopes) are preserved
      const merged = mergeImportMaps(
        getDefaultImportMap(),
        denoJsonMap ?? { imports: {}, scopes: {} },
        configMap ?? { imports: {}, scopes: {} },
      );

      return normalizeImportMapForRuntime(merged);
    },
    { "importMap.startPath": startPath },
  );
}
