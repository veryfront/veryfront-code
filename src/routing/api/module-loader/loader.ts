import { serverLogger as logger } from "@veryfront/utils";
import type { BuildResult, Plugin } from "esbuild";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { createHTTPPlugin } from "./esbuild-plugin.ts";
import { validateHTTPImports } from "./http-validator.ts";
import { loadSecurityConfig } from "./security-config.ts";
import type { APIRoute, LoadModuleOptions } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import { getEsbuildLoader } from "../../../core/utils/path-utils.ts";
import { createFileSystem, FileSystem } from "../../../platform/compat/fs.ts";
import * as pathHelper from "../../../platform/compat/path-helper.ts";
import { isDeno, isNode } from "../../../platform/compat/runtime.ts";

export async function loadHandlerModule(options: LoadModuleOptions): Promise<APIRoute | null> {
  const { projectDir, modulePath, adapter, config } = options;
  const fs = createFileSystem();

  try {
    let module: APIRoute;

    if (modulePath.endsWith(".js")) {
      // JS files can be loaded directly
      module = await loadJSModule(modulePath);
    } else if (isDeno) {
      // In Deno, try to directly import TypeScript files without bundling
      // This allows modules to share the same runtime context (including singletons like agentRegistry)
      // However, if the file doesn't exist locally (e.g., remote FSAdapter), fall back to transpile
      const fileExistsLocally = await fs.exists(modulePath);
      if (fileExistsLocally) {
        module = await loadTSModuleDirect(modulePath);
      } else {
        // File is remote (e.g., VeryfrontFSAdapter) - use adapter to read and transpile
        logger.debug(`[API] File not local, using adapter-based loading: ${modulePath}`);
        module = await loadAndTranspileModule(modulePath, projectDir, adapter, fs, config);
      }
    } else {
      // In Node.js, use esbuild to transpile TypeScript
      // Singletons are shared via globalThis pattern (see src/ai/agent/composition.ts etc.)
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

/**
 * Directly import a TypeScript module in Deno without bundling.
 * This allows the module to share the same runtime context as the dev server,
 * enabling auto-discovery features like agentRegistry to work.
 */
function loadTSModuleDirect(modulePath: string): Promise<APIRoute> {
  // Add cache buster for HMR
  const cacheBuster = `?v=${Date.now()}`;
  const url = modulePath.startsWith("file://")
    ? `${modulePath}${cacheBuster}`
    : `file://${modulePath}${cacheBuster}`;

  logger.debug(`[API] Direct import (Deno): ${url}`);
  return import(url);
}

function loadJSModule(modulePath: string): Promise<APIRoute> {
  return import(`file://${modulePath}`);
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
                // Ignore error, try next extension
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
          const loaderMap: Record<string, "tsx" | "jsx" | "ts" | "js" | "json"> = {
            tsx: "tsx",
            jsx: "jsx",
            ts: "ts",
            json: "json",
          };
          const loader = loaderMap[ext] ?? "js";

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
  fs: FileSystem, // Pass fs compat instance
  config?: VeryfrontConfig,
): Promise<APIRoute> {
  // Try to resolve the module path with various extensions if not found
  let resolvedPath = modulePath;
  let source: string | undefined;

  try {
    source = await adapter.fs.readFile(modulePath);
  } catch {
    // If file not found, try with common extensions
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

    for (const ext of extensions) {
      try {
        const pathWithExt = modulePath + ext;
        source = await adapter.fs.readFile(pathWithExt);
        resolvedPath = pathWithExt;
        break;
      } catch {
        // Continue trying other extensions
      }
    }

    if (source === undefined) {
      throw toError(createError({
        type: "file",
        message: `File not found: ${modulePath} (tried extensions: ${extensions.join(", ")})`,
      }));
    }
  }

  const loader = getEsbuildLoader(resolvedPath);

  const allowedHosts = await loadSecurityConfig(projectDir, adapter);
  validateHTTPImports(source, allowedHosts);

  const { build } = await import("esbuild");

  const plugins = [
    createImportMapPlugin(projectDir, adapter, config),
    createHTTPPlugin(allowedHosts),
  ];

  const externalPackages = [
    "ai",
    "ai/*",
    "ai/react",
    "@ai-sdk/*",
    "zod",
    "node:*",
    // Veryfront packages - should use runtime resolution, not bundled
    "veryfront",
    "veryfront/*",
    // OpenTelemetry packages used by veryfront/ai
    "@opentelemetry/*",
    // Path module - Node.js built-in
    "path",
  ];

  // Use the directory containing the source file as resolveDir
  // This allows relative imports like ../../../ai/agents to resolve correctly
  const resolveDir = pathHelper.dirname(resolvedPath);

  const result: BuildResult = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "react",
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
    external: externalPackages,
    stdin: {
      contents: source,
      loader,
      resolveDir,
      sourcefile: resolvedPath,
    },
    plugins,
  });

  if (result.errors && result.errors.length > 0) {
    const first = result.errors[0]?.text || "unknown error";
    throw toError(createError({
      type: "api",
      message: `[API] handler build failed: ${first}`,
    }));
  }

  logger.info(`[API] built handler ${resolvedPath}`);
  const js = result.outputFiles?.[0]?.text ?? "export {}";
  logger.debug(`[API] transpiled size ${js.length} bytes`);

  return await loadModuleFromCode(js, adapter, projectDir, fs);
}

async function loadModuleFromCode(
  code: string,
  _adapter: RuntimeAdapter,
  projectDir: string,
  fs: FileSystem,
): Promise<APIRoute> {
  const tempDir = await fs.makeTempDir({ prefix: "vf-api-" });
  const tempFile = pathHelper.join(tempDir, "handler.mjs");

  const transformedCode = await rewriteExternalImports(code, projectDir, fs);

  await fs.writeTextFile(tempFile, transformedCode);

  try {
    return await import(`file://${tempFile}?v=${Date.now()}`);
  } catch (e: unknown) {
    const errorMessage = e instanceof Error && e.stack ? e.stack : String(e);
    logger.error(`[API] dynamic import failed ${tempFile}: ${errorMessage}`);
    throw e;
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

async function rewriteExternalImports(
  code: string,
  projectDir: string,
  fs: FileSystem,
): Promise<string> {
  let transformed = code;

  // In Node.js, resolve external imports to absolute paths
  // since the temp file is outside the project's node_modules
  if (isNode) {
    try {
      const { pathToFileURL } = await import("node:url");

      logger.debug(`[API] Rewriting external imports for Node.js, projectDir: ${projectDir}`);

      // Helper to resolve a package to absolute file:// URL
      const resolvePackageToFileUrl = async (packageName: string): Promise<string | null> => {
        const packagePath = pathHelper.join(projectDir, "node_modules", packageName);
        const packageJsonPath = pathHelper.join(packagePath, "package.json");

        try {
          const pkgJson = JSON.parse(await fs.readTextFile(packageJsonPath));
          // Try exports["."].import, exports["."].default, main, module in that order
          let entryPoint: string | undefined;

          if (pkgJson.exports) {
            const dotExport = pkgJson.exports["."];
            if (typeof dotExport === "string") {
              entryPoint = dotExport;
            } else if (dotExport?.import) {
              entryPoint = dotExport.import;
            } else if (dotExport?.default) {
              entryPoint = dotExport.default;
            }
          }

          if (!entryPoint) {
            entryPoint = pkgJson.module || pkgJson.main || "index.js";
          }

          if (!entryPoint) {
            return null;
          }

          const resolvedPath = pathHelper.join(packagePath, entryPoint);
          return pathToFileURL(resolvedPath).href;
        } catch {
          return null;
        }
      };

      // List of external packages that need to be resolved to absolute paths
      const externalPackagesToResolve = [
        "zod",
        "ai",
        "@ai-sdk/anthropic",
        "@ai-sdk/openai",
        "@ai-sdk/google",
        "@ai-sdk/mistral",
        "@ai-sdk/provider",
        "@ai-sdk/provider-utils",
      ];

      // Resolve external packages to absolute paths
      for (const pkg of externalPackagesToResolve) {
        const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        // Match static imports: from "package"
        const staticImportRegex = new RegExp(`from\\s+["']${escapedPkg}["']`, "g");
        if (staticImportRegex.test(transformed)) {
          const resolvedUrl = await resolvePackageToFileUrl(pkg);
          if (resolvedUrl) {
            transformed = transformed.replace(staticImportRegex, `from "${resolvedUrl}"`);
            logger.debug(`[API] Resolved ${pkg} -> ${resolvedUrl}`);
          }
        }

        // Match dynamic imports: import("package")
        const dynamicImportRegex = new RegExp(`import\\s*\\(\\s*["']${escapedPkg}["']\\s*\\)`, "g");
        if (dynamicImportRegex.test(transformed)) {
          const resolvedUrl = await resolvePackageToFileUrl(pkg);
          if (resolvedUrl) {
            transformed = transformed.replace(dynamicImportRegex, `import("${resolvedUrl}")`);
            logger.debug(`[API] Resolved dynamic import ${pkg} -> ${resolvedUrl}`);
          }
        }
      }

      // Manual resolution for veryfront using package.json exports
      // This is more reliable than createRequire for subpath exports
      const vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
      const vfPackageJsonPath = pathHelper.join(vfPackagePath, "package.json");

      let exportsMap: Record<string, { import?: string }> = {};
      try {
        const pkgJson = JSON.parse(await fs.readTextFile(vfPackageJsonPath));
        exportsMap = pkgJson.exports || {};
      } catch (err) {
        logger.debug(`[API] Could not read veryfront package.json: ${err}`);
      }

      // Resolve veryfront subpath imports (e.g., veryfront/ai)
      transformed = transformed.replace(
        /from\s+["'](veryfront\/[^"']+)["']/g,
        (_match, fullSpecifier: string) => {
          const subpath = "./" + fullSpecifier.replace("veryfront/", "");
          const exportEntry = exportsMap[subpath];
          if (exportEntry?.import) {
            const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
            logger.debug(`[API] Resolved ${fullSpecifier} -> ${resolvedPath}`);
            return `from "${pathToFileURL(resolvedPath).href}"`;
          }
          logger.warn(`[API] No export found for ${subpath}`);
          return _match;
        },
      );

      // Resolve bare veryfront import
      transformed = transformed.replace(
        /from\s+["']veryfront["']/g,
        () => {
          const exportEntry = exportsMap["."];
          if (exportEntry?.import) {
            const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
            logger.debug(`[API] Resolved veryfront -> ${resolvedPath}`);
            return `from "${pathToFileURL(resolvedPath).href}"`;
          }
          return 'from "veryfront"';
        },
      );
    } catch (e) {
      // If node:module import fails, we're not in Node.js or something went wrong
      logger.warn(`[API] Failed to import node:module: ${e}`);
      // Fall through to Deno handling
    }
  }

  // For Deno, use npm: specifiers for selected packages
  // For Node.js, these are typically resolved via node_modules
  // This list should only include packages that are externalized by esbuild but need explicit npm: specifiers in Deno
  const externalPackages = [
    { pattern: /from\s+["']ai["']/g, replacement: 'from "npm:ai@latest"' },
    {
      pattern: /from\s+["']@ai-sdk\/anthropic["']/g,
      replacement: 'from "npm:@ai-sdk/anthropic@latest"',
    },
    { pattern: /from\s+["']@ai-sdk\/openai["']/g, replacement: 'from "npm:@ai-sdk/openai@latest"' },
    { pattern: /from\s+["']@ai-sdk\/google["']/g, replacement: 'from "npm:@ai-sdk/google@latest"' },
    {
      pattern: /from\s+["']@ai-sdk\/mistral["']/g,
      replacement: 'from "npm:@ai-sdk/mistral@latest"',
    },
    {
      pattern: /from\s+["']@ai-sdk\/provider["']/g,
      replacement: 'from "npm:@ai-sdk/provider@latest"',
    },
    {
      pattern: /from\s+["']@ai-sdk\/provider-utils["']/g,
      replacement: 'from "npm:@ai-sdk/provider-utils@latest"',
    },
    { pattern: /from\s+["']zod["']/g, replacement: 'from "npm:zod@latest"' },
    { pattern: /import\s*\(\s*["']ai["']\s*\)/g, replacement: 'import("npm:ai@latest")' },
    {
      pattern: /import\s*\(\s*["']@ai-sdk\/anthropic["']\s*\)/g,
      replacement: 'import("npm:@ai-sdk/anthropic@latest")',
    },
    {
      pattern: /import\s*\(\s*["']@ai-sdk\/openai["']\s*\)/g,
      replacement: 'import("npm:@ai-sdk/openai@latest")',
    },
    {
      pattern: /import\s*\(\s*["']@ai-sdk\/google["']\s*\)/g,
      replacement: 'import("npm:@ai-sdk/google@latest")',
    },
    {
      pattern: /import\s*\(\s*["']@ai-sdk\/mistral["']\s*\)/g,
      replacement: 'import("npm:@ai-sdk/mistral@latest")',
    },
    {
      pattern: /import\s*\(\s*["']@ai-sdk\/provider["']\s*\)/g,
      replacement: 'import("npm:@ai-sdk/provider@latest")',
    },
    {
      pattern: /import\s*\(\s*["']@ai-sdk\/provider-utils["']\s*\)/g,
      replacement: 'import("npm:@ai-sdk/provider-utils@latest")',
    },
    { pattern: /import\s*\(\s*["']zod["']\s*\)/g, replacement: 'import("npm:zod@latest")' },
  ];

  // Apply npm: specifier rewrites only if not in Node.js (i.e., in Deno)
  if (isDeno) {
    for (const { pattern, replacement } of externalPackages) {
      transformed = transformed.replace(pattern, replacement);
    }
  }

  return transformed;
}

function extractAPIRouteHandlers(module: unknown): APIRoute {
  if (!module || typeof module !== "object") {
    return {};
  }

  const mod = module as Record<string, unknown>;
  const handler: APIRoute = {};
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "default"] as const;

  for (const method of methods) {
    if (typeof mod[method] === "function") {
      handler[method] = mod[method] as APIRoute[typeof method];
    }
  }

  return handler;
}
