import { rendererLogger as logger } from "#veryfront/utils";
import { dirname, join } from "#veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getConfig } from "#veryfront/config";
import type { ImportMapConfig } from "./types.ts";
import { getDefaultImportMap } from "./default-import-map.ts";
import { mergeImportMaps } from "./merger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

function normalizeImportMapForRuntime(importMap: ImportMapConfig): ImportMapConfig {
  const normalizeValue = (value: string): string => {
    if (!value.startsWith("npm:")) return value;

    const spec = value.slice(4);
    const [base, query] = spec.split("?");
    const url = `https://esm.sh/${base}`;

    return query ? `${url}?${query}` : `${url}?target=es2022`;
  };

  const imports = importMap.imports
    ? Object.fromEntries(Object.entries(importMap.imports).map(([k, v]) => [k, normalizeValue(v)]))
    : undefined;

  const scopes = importMap.scopes
    ? Object.fromEntries(
      Object.entries(importMap.scopes).map(([scope, mappings]) => [
        scope,
        Object.fromEntries(
          Object.entries(mappings).map(([k, v]) => [k, normalizeValue(v)]),
        ),
      ]),
    )
    : undefined;

  return { imports, scopes };
}

function mergeWithDefault(
  importMap: { imports?: Record<string, string>; scopes?: Record<string, Record<string, string>> },
): ImportMapConfig {
  return mergeImportMaps(getDefaultImportMap(), {
    imports: importMap.imports ?? {},
    scopes: importMap.scopes ?? {},
  });
}

export function loadImportMap(
  startPath: string,
  adapter?: RuntimeAdapter,
): Promise<ImportMapConfig> {
  return withSpan(
    "modules.importMap.load",
    async () => {
      const runtimeAdapter = adapter ??
        (await (async () => {
          const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
          return runtime.get();
        })());

      try {
        const cfg = await getConfig(startPath, runtimeAdapter);
        const importMap = cfg?.resolve?.importMap;

        if (importMap && typeof importMap === "object") {
          return normalizeImportMapForRuntime(mergeWithDefault(importMap));
        }
      } catch {
        // Config not found or invalid, fall through to file-based discovery
      }

      let currentPath = startPath;

      while (currentPath !== "/" && currentPath !== "") {
        const denoJsonPath = join(currentPath, "deno.json");

        try {
          const content = await runtimeAdapter.fs.readFile(denoJsonPath);
          const config = JSON.parse(content);

          if (config.imports || config.scopes) {
            logger.debug(`Loaded import map from ${denoJsonPath}`);
            return normalizeImportMapForRuntime(mergeWithDefault(config));
          }
        } catch {
          // deno.json not found in this directory, continue searching
        }

        const parent = dirname(currentPath);
        if (parent === currentPath) break;
        currentPath = parent;
      }

      return normalizeImportMapForRuntime(getDefaultImportMap());
    },
    { "importMap.startPath": startPath },
  );
}
