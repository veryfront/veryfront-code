import { rendererLogger as logger } from "#veryfront/utils";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getConfig } from "#veryfront/config";
import type { ImportMapConfig } from "./types.ts";
import { getDefaultImportMap } from "./default-import-map.ts";
import { mergeImportMaps, sanitizeImportMap } from "./merger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getReactImportMap } from "#veryfront/transforms/esm/package-registry.ts";
import { IMPORT_MAP_INVALID, INVALID_ARGUMENT } from "#veryfront/errors";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_IMPORT_MAP_CONFIG_BYTES = 1024 * 1024;
const MAX_IMPORT_MAP_START_PATH_LENGTH = 4_096;

function parseImportMapConfig(content: string): ImportMapConfig {
  if (new TextEncoder().encode(content).byteLength > MAX_IMPORT_MAP_CONFIG_BYTES) {
    throw IMPORT_MAP_INVALID.create({ detail: "Import-map configuration exceeds size limit" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw IMPORT_MAP_INVALID.create({ detail: "Import-map configuration is not valid JSON" });
  }
  const sanitized = sanitizeImportMap(parsed);
  if (!sanitized) {
    throw IMPORT_MAP_INVALID.create({ detail: "Import-map configuration has an invalid shape" });
  }
  return sanitized;
}

function normalizeImportMapForRuntime(importMap: ImportMapConfig): ImportMapConfig {
  const normalizeValue = (value: string): string => {
    if (!value.startsWith("npm:")) return value;

    // Convert npm: specifiers to esm.sh URLs (should not happen with new code)
    const spec = value.slice(4);
    const queryStart = spec.indexOf("?");
    const base = queryStart === -1 ? spec : spec.slice(0, queryStart);
    const query = queryStart === -1 ? "" : spec.slice(queryStart + 1);
    const url = `https://esm.sh/${base}`;

    return query ? `${url}?${query}` : `${url}?target=es2022`;
  };

  let imports = importMap.imports
    ? Object.fromEntries(Object.entries(importMap.imports).map(([k, v]) => [k, normalizeValue(v)]))
    : undefined;

  let scopes = importMap.scopes
    ? Object.fromEntries(
      Object.entries(importMap.scopes).map(([scope, mappings]) => [
        scope,
        Object.fromEntries(Object.entries(mappings).map(([k, v]) => [k, normalizeValue(v)])),
      ]),
    )
    : undefined;

  // Override React mappings AFTER all other processing to ensure single instance.
  // Remove any "react/" prefix match since we have explicit mappings.
  const veryfrontSsrMap = Object.fromEntries(
    Object.entries(getDefaultImportMap().imports ?? {}).filter(([key]) =>
      key.startsWith("veryfront/")
    ),
  );
  const reactMap = getReactImportMap();
  const enforceRuntimeMappings = (mappings: Record<string, string>) => {
    const normalized = { ...mappings };
    delete normalized["react/"];
    return { ...normalized, ...veryfrontSsrMap, ...reactMap };
  };
  imports = enforceRuntimeMappings(imports ?? {});
  if (scopes) {
    scopes = Object.fromEntries(
      Object.entries(scopes).map(([scope, mappings]) => [
        scope,
        enforceRuntimeMappings(mappings),
      ]),
    );
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
  return Object.fromEntries(
    Object.entries(imports).filter(([, value]) =>
      !value.startsWith("./") && !value.startsWith("../")
    ),
  );
}

async function loadDenoJsonImportMap(
  startPath: string,
  adapter: RuntimeAdapter,
): Promise<ImportMapConfig | null> {
  // For virtual filesystems (API-backed), only check project root
  // Virtual filesystems use relative paths, not absolute local paths
  if (isVirtualFilesystem(adapter.fs)) {
    if (!await adapter.fs.exists("deno.json")) return null;
    const content = await adapter.fs.readFile("deno.json");
    const config = parseImportMapConfig(content);
    logger.debug("Loaded import map from deno.json (virtual filesystem)");
    const imports = config.imports ? filterRelativePaths(config.imports) : {};
    const scopes = config.scopes
      ? Object.fromEntries(
        Object.entries(config.scopes).map(
          ([scope, mappings]) => [scope, filterRelativePaths(mappings)],
        ),
      )
      : {};
    return { imports, scopes };
  }

  // For local filesystems, walk up directory tree
  let currentPath = startPath;

  while (currentPath !== "/" && currentPath !== "") {
    const denoJsonPath = join(currentPath, "deno.json");

    if (await adapter.fs.exists(denoJsonPath)) {
      const content = await adapter.fs.readFile(denoJsonPath);
      const config = parseImportMapConfig(content);
      logger.debug("Loaded import map from deno.json");
      const imports = config.imports ? filterRelativePaths(config.imports) : {};
      const scopes = config.scopes
        ? Object.fromEntries(
          Object.entries(config.scopes).map(
            ([scope, mappings]) => [scope, filterRelativePaths(mappings)],
          ),
        )
        : {};
      return { imports, scopes };
    }

    const parent = dirname(currentPath);
    if (parent === currentPath) break;
    currentPath = parent;
  }

  return null;
}

export function loadImportMap(
  startPath: string,
  adapter?: RuntimeAdapter,
): Promise<ImportMapConfig> {
  if (
    startPath.length === 0 || startPath.length > MAX_IMPORT_MAP_START_PATH_LENGTH ||
    hasUnsafeControlCharacters(startPath)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Import-map start path is invalid" });
  }
  return withSpan(
    "modules.importMap.load",
    async () => {
      const runtimeAdapter = await getRuntimeAdapter(adapter);

      // First, load import map from deno.json (if exists)
      const denoJsonMap = await loadDenoJsonImportMap(startPath, runtimeAdapter);

      // Then, try to get config's import map
      let configMap: ImportMapConfig | null = null;
      const cfg = await getConfig(startPath, runtimeAdapter);
      const importMap = cfg?.resolve?.importMap;
      if (importMap !== undefined) {
        configMap = sanitizeImportMap(importMap);
        if (!configMap) {
          throw IMPORT_MAP_INVALID.create({
            detail: "Veryfront import-map configuration has an invalid shape",
          });
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
    {},
  );
}
