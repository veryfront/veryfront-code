import { rendererLogger as logger } from "@veryfront/utils";
import { dirname, join } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { getConfig } from "@veryfront/config";
import type { ImportMapConfig } from "./types.ts";
import { getDefaultImportMap } from "./default-import-map.ts";

export async function loadImportMap(
  startPath: string,
  adapter?: RuntimeAdapter,
): Promise<ImportMapConfig> {
  let runtimeAdapter = adapter;
  if (!runtimeAdapter) {
    const { getAdapter } = await import("@veryfront/platform/adapters/detect.ts");
    runtimeAdapter = await getAdapter();
  }

  try {
    const cfg = await getConfig(startPath, runtimeAdapter!);
    if (cfg?.resolve?.importMap && typeof cfg.resolve.importMap === "object") {
      return {
        imports: cfg.resolve.importMap.imports ?? {},
        scopes: cfg.resolve.importMap.scopes ?? {},
      };
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
        return {
          imports: config.imports ?? {},
          scopes: config.scopes ?? {},
        };
      }
    } catch {
      // deno.json not found in this directory, continue searching
    }

    const parent = dirname(currentPath);
    if (parent === currentPath) break; // Reached root
    currentPath = parent;
  }

  return getDefaultImportMap();
}
