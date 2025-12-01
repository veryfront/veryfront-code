import { serverLogger as logger } from "@veryfront/utils";
import type { BuildResult, Plugin } from "esbuild";
import { dirname, isAbsolute, join, resolve } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { createHTTPPlugin } from "./esbuild-plugin.ts";
import { validateHTTPImports } from "./http-validator.ts";
import { loadSecurityConfig } from "./security-config.ts";
import type { APIRoute, LoadModuleOptions } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export async function loadHandlerModule(options: LoadModuleOptions): Promise<APIRoute | null> {
  const { projectDir, modulePath, adapter, config } = options;

  try {
    const module = modulePath.endsWith(".js")
      ? await loadJSModule(modulePath)
      : await loadAndTranspileModule(modulePath, projectDir, adapter, config);

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
          const importerDir = dirname(args.importer);
          const absolutePath = resolve(importerDir, args.path);

          logger.debug(
            `[API] Import map relative resolve: ${args.path} (from ${args.importer}) -> ${absolutePath}`,
          );

          return {
            path: absolutePath,
            namespace: "import-map",
          };
        }

        if (isAbsolute(args.path) && args.namespace !== "import-map") {
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

          const absolutePath = isAbsolute(resolvedPath)
            ? resolvedPath
            : resolve(projectDir, resolvedPath);

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
            resolveDir: dirname(filePath),
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
  config?: VeryfrontConfig,
): Promise<APIRoute> {
  const source = await adapter.fs.readFile(modulePath);

  const isTsx = modulePath.endsWith(".tsx");
  const isJsx = modulePath.endsWith(".jsx");
  const loader = isTsx ? "tsx" : isJsx ? "jsx" : modulePath.endsWith(".ts") ? "ts" : "js";

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
    "std/*",
    "@std/*",
    "https://deno.land/*",
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
  const resolveDir = dirname(modulePath);

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
      sourcefile: modulePath,
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

  logger.info(`[API] built handler ${modulePath}`);
  const js = result.outputFiles?.[0]?.text ?? "export {}";
  logger.debug(`[API] transpiled size ${js.length} bytes`);

  return await loadModuleFromCode(js, adapter, projectDir);
}

async function loadModuleFromCode(code: string, adapter: RuntimeAdapter, projectDir: string): Promise<APIRoute> {
  const tempDir = await createTempDir(adapter);
  const tempFile = join(tempDir, "handler.mjs");

  const transformedCode = await rewriteExternalImports(code, projectDir);

  await writeTempFile(tempFile, transformedCode, adapter);

  try {
    return await import(`file://${tempFile}?v=${Date.now()}`);
  } catch (e: unknown) {
    const errorMessage = e instanceof Error && e.stack ? e.stack : String(e);
    logger.error(`[API] dynamic import failed ${tempFile}: ${errorMessage}`);
    throw e;
  } finally {
    await removeTempDir(tempDir, adapter);
  }
}

// Detect if running in Node.js (vs Deno/browser)
function isNodeRuntime(): boolean {
  // deno-lint-ignore no-explicit-any
  const _global = globalThis as any;
  return typeof Deno === "undefined" && typeof _global.process !== "undefined" && !!_global.process?.versions?.node;
}

async function rewriteExternalImports(code: string, projectDir: string): Promise<string> {
  let transformed = code;

  // In Node.js, resolve veryfront imports to absolute paths
  // since the temp file is outside the project's node_modules
  if (isNodeRuntime()) {
    try {
      const { pathToFileURL } = await import("node:url");

      logger.debug(`[API] Rewriting external imports for Node.js, projectDir: ${projectDir}`);

      // Manual resolution using package.json exports
      // This is more reliable than createRequire for subpath exports
      const vfPackagePath = join(projectDir, "node_modules", "veryfront");
      const vfPackageJsonPath = join(vfPackagePath, "package.json");

      let exportsMap: Record<string, { import?: string }> = {};
      try {
        const pkgJson = JSON.parse(await (await import("node:fs/promises")).readFile(vfPackageJsonPath, "utf-8"));
        exportsMap = pkgJson.exports || {};
      } catch {
        logger.debug("[API] Could not read veryfront package.json");
      }

      // Resolve veryfront subpath imports (e.g., veryfront/ai)
      transformed = transformed.replace(
        /from\s+["'](veryfront\/[^"']+)["']/g,
        (_match, fullSpecifier: string) => {
          const subpath = "./" + fullSpecifier.replace("veryfront/", "");
          const exportEntry = exportsMap[subpath];
          if (exportEntry?.import) {
            const resolvedPath = join(vfPackagePath, exportEntry.import);
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
            const resolvedPath = join(vfPackagePath, exportEntry.import);
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

  // For Deno, use npm: specifiers
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

  for (const { pattern, replacement } of externalPackages) {
    transformed = transformed.replace(pattern, replacement);
  }

  return transformed;
}

async function createTempDir(adapter: RuntimeAdapter): Promise<string> {
  try {
    return await adapter.fs.makeTempDir("vf-api-");
  } catch (error) {
    if (typeof Deno !== "undefined" && Deno.makeTempDir) {
      return await Deno.makeTempDir({ prefix: "vf-api-" });
    }
    throw error;
  }
}

async function writeTempFile(path: string, code: string, adapter: RuntimeAdapter): Promise<void> {
  try {
    await adapter.fs.writeFile(path, code);
  } catch (error) {
    if (typeof Deno !== "undefined" && Deno.writeTextFile) {
      await Deno.writeTextFile(path, code);
      return;
    }
    throw error;
  }
}

async function removeTempDir(tempDir: string, adapter: RuntimeAdapter): Promise<void> {
  try {
    await adapter.fs.remove(tempDir, { recursive: true });
  } catch (error) {
    if (typeof Deno !== "undefined" && Deno.remove) {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch (_error) {
        void _error;
      }
      return;
    }
    logger.debug(`[API] failed to cleanup temp dir ${tempDir}`, error);
  }
}

function extractAPIRouteHandlers(module: unknown): APIRoute {
  const handler: APIRoute = {};

  if (!module || typeof module !== "object") {
    return handler;
  }

  const mod = module as Record<string, unknown>;

  if (typeof mod.GET === "function") handler.GET = mod.GET as APIRoute["GET"];
  if (typeof mod.POST === "function") handler.POST = mod.POST as APIRoute["POST"];
  if (typeof mod.PUT === "function") handler.PUT = mod.PUT as APIRoute["PUT"];
  if (typeof mod.PATCH === "function") handler.PATCH = mod.PATCH as APIRoute["PATCH"];
  if (typeof mod.DELETE === "function") handler.DELETE = mod.DELETE as APIRoute["DELETE"];
  if (typeof mod.HEAD === "function") handler.HEAD = mod.HEAD as APIRoute["HEAD"];
  if (typeof mod.OPTIONS === "function") handler.OPTIONS = mod.OPTIONS as APIRoute["OPTIONS"];

  if (typeof mod.default === "function") {
    handler.default = mod.default as APIRoute["default"];
  }

  return handler;
}
