import { serverLogger as logger } from "@veryfront/utils";
import type { BuildResult, Plugin } from "esbuild";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { createHTTPPlugin } from "./esbuild-plugin.ts";
import { validateHTTPImports } from "./http-validator.ts";
import { loadSecurityConfig } from "./security-config.ts";
import type { APIRoute, LoadModuleOptions } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import { createFileSystem, FileSystem } from "../../../platform/compat/fs.ts";
import * as pathHelper from "../../../platform/compat/path-helper.ts";
import { isDeno, isNode } from "../../../platform/compat/runtime.ts";

export async function loadHandlerModule(options: LoadModuleOptions): Promise<APIRoute | null> {
  const { projectDir, modulePath, adapter, config } = options;
  const fs = createFileSystem();

  try {
    let module: APIRoute;

    if (modulePath.endsWith(".js")) {
      module = await loadJSModule(modulePath);
    } else if (isDeno) {
      module = await loadTSModuleDirect(modulePath);
    } else {
      module = await loadAndTranspileModule(modulePath, projectDir, adapter, fs, config);
    }

    return extractAPIRouteHandlers(module);
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to load API handler ${modulePath}:`, error);
    throw toError(createError({
      type: "api",
      message: `Failed to load API handler: ${errorMsg}`,
    }));
  }
}

async function loadTSModuleDirect(modulePath: string): Promise<APIRoute> {
  const cacheBuster = `?v=${Date.now()}`;
  const url = modulePath.startsWith("file://")
    ? `${modulePath}${cacheBuster}`
    : `file://${modulePath}${cacheBuster}`;

  logger.debug(`[API] Direct import (Deno): ${url}`);
  return await import(url);
}

async function loadJSModule(modulePath: string): Promise<APIRoute> {
  return await import(`file://${modulePath}`);
}

function createImportMapPlugin(
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
): Plugin {
  const importMap = config?.resolve?.importMap?.imports || {};
  const hasImportMap = Object.keys(importMap).length > 0;

  if (!hasImportMap) {
    return {
      name: "import-map",
      setup() {},
    };
  }

  logger.info(`[API] Using import map with ${Object.keys(importMap).length} entries`);

  return {
    name: "import-map",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith("http://") || args.path.startsWith("https://")) {
          return undefined;
        }

        if (args.path.startsWith("node:")) {
          return { path: args.path, external: true };
        }

        if (args.path === "ai/react" || args.path.startsWith("ai/react/")) {
          return { path: args.path, external: true };
        }

        if (
          args.path.includes("bundle-manifest-kv") ||
          args.path.includes("bundle-manifest-redis")
        ) {
          return { path: args.path, external: true };
        }

        if (args.namespace === "import-map" && args.path.startsWith(".")) {
          const importerDir = pathHelper.dirname(args.importer);
          const absolutePath = pathHelper.resolve(importerDir, args.path);

          logger.debug(
            `[API] Import map relative resolve: ${args.path} (from ${args.importer}) -> ${absolutePath}`,
          );

          return {
            path: absolutePath,
            namespace: "import-map",
          };
        }

        if (pathHelper.isAbsolute(args.path) && args.namespace !== "import-map") {
          return undefined;
        }

        let resolvedPath: string | undefined;

        if (importMap[args.path]) {
          resolvedPath = importMap[args.path];
        } else {
          for (const [key, value] of Object.entries(importMap)) {
            if (key.endsWith("/") && args.path.startsWith(key)) {
              const suffix = args.path.slice(key.length);
              resolvedPath = value + suffix;
              break;
            }
          }
        }

        if (resolvedPath) {
          if (resolvedPath.startsWith("http://") || resolvedPath.startsWith("https://")) {
            logger.debug(`[API] Import map resolved to HTTP URL: ${args.path} -> ${resolvedPath}`);
            return undefined;
          }

          const absolutePath = pathHelper.isAbsolute(resolvedPath)
            ? resolvedPath
            : pathHelper.resolve(projectDir, resolvedPath);

          logger.debug(`[API] Import map resolved: ${args.path} -> ${absolutePath}`);

          return {
            path: absolutePath,
            namespace: "import-map",
          };
        }

        return undefined;
      });

      build.onLoad({ filter: /.*/, namespace: "import-map" }, async (args) => {
        try {
          let filePath = args.path;
          let contents = "";

          try {
            contents = await adapter.fs.readFile(filePath);
          } catch {
            const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
            let found = false;

            for (const ext of extensions) {
              try {
                const pathWithExt = filePath + ext;
                contents = await adapter.fs.readFile(pathWithExt);
                filePath = pathWithExt;
                found = true;
                break;
              } catch {
              }
            }

            if (!found) {
              throw toError(createError({
                type: "file",
                message: `File not found: ${filePath}`,
              }));
            }
          }

          const ext = filePath.split(".").pop() || "";
          const loader = ext === "tsx"
            ? "tsx"
            : ext === "jsx"
            ? "jsx"
            : ext === "ts"
            ? "ts"
            : ext === "js"
            ? "js"
            : ext === "json"
            ? "json"
            : "js";

          return {
            contents,
            loader,
            resolveDir: pathHelper.dirname(filePath),
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error(`[API] Failed to load file via import map: ${args.path}`, error);
          return {
            errors: [{ text: `Failed to load: ${msg}` }],
          };
        }
      });
    },
  };
}

async function loadAndTranspileModule(
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  fs: FileSystem,
  config?: VeryfrontConfig,
): Promise<APIRoute> {
  let resolvedPath = modulePath;
  let source: string | undefined;

  try {
    source = await adapter.fs.readFile(modulePath);
  } catch {
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

    for (const ext of extensions) {
      try {
        const pathWithExt = modulePath + ext;
        source = await adapter.fs.readFile(pathWithExt);
        resolvedPath = pathWithExt;
        break;
      } catch {
      }
    }

    if (source === undefined) {
      throw toError(createError({
        type: "file",
        message: `File not found: ${modulePath} (tried extensions: ${extensions.join(", ")})`,
      }));
    }
  }

  const isTsx = resolvedPath.endsWith(".tsx");
  const isJsx = resolvedPath.endsWith(".jsx");
  const loader = isTsx ? "tsx" : isJsx ? "jsx" : resolvedPath.endsWith(".ts") ? "ts" : "js";

  const allowedHosts = await loadSecurityConfig(projectDir, adapter);
  validateHTTPImports(source, allowedHosts);

  const { build } = await import("esbuild");

  const plugins = [
    createImportMapPlugin(projectDir, adapter, config),
    createHTTPPlugin(allowedHosts),
  ];

  const externalPackages = [
    "ai",
    "ai