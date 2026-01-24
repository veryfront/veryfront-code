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
    ? Object.fromEntries(
      Object.entries(importMap.imports).map(([key, value]) => [key, normalizeValue(value)]),
    )
    : undefined;

  const scopes = importMap.scopes
    ? Object.fromEntries(
      Object.entries(importMap.scopes).map(([scope, mappings]) => [
        scope,
        Object.fromEntries(
          Object.entries(mappings).map(([key, value]) => [key, normalizeValue(value)]),
        ),
      ]),
    )
    : undefined;

  return { imports, scopes };
}

export function loadImportMap(
  startPath: string,
  adapter?: RuntimeAdapter,
): Promise<ImportMapConfig> {
  return withSpan("modules.importMap.load", async () => {
    let runtimeAdapter = adapter;
    if (!runtimeAdapter) {
      const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
      runtimeAdapter = await runtime.get();
    }

    try {
      const cfg = await getConfig(startPath, runtimeAdapter!);
      if (cfg?.resolve?.importMap && typeof cfg.resolve.importMap === "object") {
        const merged = mergeImportMaps(
          getDefaultImportMap(),
          {
            imports: cfg.resolve.importMap.imports ?? {},
            scopes: cfg.resolve.importMap.scopes ?? {},
          },
        );
        return normalizeImportMapForRuntime(merged);
      }
    } catch {
      // Config not found or invalid, fall through to file-based discovery
    }

    let currentPath = startPath;

    while (currentPath !== "/" && currentPath !== "") {
      const denoJsonPath = join(currentPath, "deno.json");

      try {
        const content = await runtimeAdapter!.fs.readFile(denoJsonPath);
        const config = JSON.parse(content);

        if (config.imports || config.scopes) {
          logger.debug(`Loaded import map from ${denoJsonPath}`);
          const merged = mergeImportMaps(
            getDefaultImportMap(),
            {
              imports: config.imports ?? {},
              scopes: config.scopes ?? {},
            },
          );
          return normalizeImportMapForRuntime(merged);
        }
      } catch {
        // deno.json not found in this directory, continue searching
      }

      const parent = dirname(currentPath);
      if (parent === currentPath) break; // Reached root
      currentPath = parent;
    }

    return normalizeImportMapForRuntime(getDefaultImportMap());
  }, { "importMap.startPath": startPath });
}
