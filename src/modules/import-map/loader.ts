import { rendererLogger as logger } from "#veryfront/utils";
import { dirname, join } from "#veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getConfig } from "#veryfront/config";
import type { ImportMapConfig } from "./types.ts";
import { getDefaultImportMap } from "./default-import-map.ts";
import { mergeImportMaps } from "./merger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getReactImportMap } from "#veryfront/transforms/esm/package-registry.ts";

function normalizeImportMapForRuntime(importMap: ImportMapConfig): ImportMapConfig {
  const normalizeValue = (value: string): string => {
    if (!value.startsWith("npm:")) return value;

    // Convert npm: specifiers to esm.sh URLs (should not happen with new code)
    const spec = value.slice(4);
    const [base, query] = spec.split("?");
    const url = `https://esm.sh/${base}`;

    return query ? `${url}?${query}` : `${url}?target=es2022`;
  };

  let imports = importMap.imports
    ? Object.fromEntries(Object.entries(importMap.imports).map(([k, v]) => [k, normalizeValue(v)]))
    : undefined;

  const scopes = importMap.scopes
    ? Object.fromEntries(
      Object.entries(importMap.scopes).map(([scope, mappings]) => [
        scope,
        Object.fromEntries(Object.entries(mappings).map(([k, v]) => [k, normalizeValue(v)])),
      ]),
    )
    : undefined;

  // Override React mappings AFTER all other processing to ensure single instance.
  // Remove any "react/" prefix match since we have explicit mappings.
  if (imports) {
    const reactMap = getReactImportMap();
    delete imports["react/"];
    imports = { ...imports, ...reactMap };
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
    try {
      const content = await adapter.fs.readFile("deno.json");
      const config = JSON.parse(content);

      if (config.imports || config.scopes) {
        logger.debug("Loaded import map from deno.json (virtual filesystem)");
        const imports = config.imports ? filterRelativePaths(config.imports) : {};
        const scopes = config.scopes
          ? Object.fromEntries(
            Object.entries(config.scopes as Record<string, Record<string, string>>).map(
              ([scope, mappings]) => [scope, filterRelativePaths(mappings)],
            ),
          )
          : {};
        return { imports, scopes };
      }
    } catch {
      // deno.json not found in virtual filesystem
    }
    return null;
  }

  // For local filesystems, walk up directory tree
  let currentPath = startPath;

  while (currentPath !== "/" && currentPath !== "") {
    const denoJsonPath = join(currentPath, "deno.json");

    try {
      const content = await adapter.fs.readFile(denoJsonPath);
      const config = JSON.parse(content);

      if (config.imports || config.scopes) {
        logger.debug(`Loaded import map from ${denoJsonPath}`);
        const imports = config.imports ? filterRelativePaths(config.imports) : {};
        const scopes = config.scopes
          ? Object.fromEntries(
            Object.entries(config.scopes as Record<string, Record<string, string>>).map(
              ([scope, mappings]) => [scope, filterRelativePaths(mappings)],
            ),
          )
          : {};
        return { imports, scopes };
      }
    } catch {
      // deno.json not found in this directory, continue searching
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
  return withSpan(
    "modules.importMap.load",
    async () => {
      const runtimeAdapter = await getRuntimeAdapter(adapter);

      // First, load import map from deno.json (if exists)
      const denoJsonMap = await loadDenoJsonImportMap(startPath, runtimeAdapter);

      // Then, try to get config's import map
      let configMap: ImportMapConfig | null = null;
      try {
        const cfg = await getConfig(startPath, runtimeAdapter);
        const importMap = cfg?.resolve?.importMap;
        if (importMap && typeof importMap === "object") {
          configMap = {
            imports: importMap.imports ?? {},
            scopes: importMap.scopes ?? {},
          };
        }
      } catch {
        // Config not found or invalid, continue without it
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
