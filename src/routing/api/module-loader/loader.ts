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

/**
 * Creates an esbuild plugin that resolves imports using the config's import map
 * All file operations go through the RuntimeAdapter for virtual/remote file support
 */
function createImportMapPlugin(
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
): Plugin {
  const importMap = config?.resolve?.importMap?.imports || {};
  const hasImportMap = Object.keys(importMap).length > 0;

  if (!hasImportMap) {
    // No import map, return empty plugin
    return {
      name: "import-map",
      setup() {},
    };
  }

  logger.info(`[API] Using import map with ${Object.keys(importMap).length} entries`);

  return {
    name: "import-map",
    setup(build) {
      // Resolve bare specifiers using import map AND relative imports from import-map files
      build.onResolve({ filter: /.*/ }, (args) => {
        // Skip http(s) imports - handled by HTTP plugin
        if (args.path.startsWith("http://") || args.path.startsWith("https://")) {
          return undefined;
        }

        // Mark node: imports as external (they should not be bundled)
        if (args.path.startsWith("node:")) {
          return { path: args.path, external: true };
        }

        // Mark ai/react as external (client-side only, should never be in server bundles)
        if (args.path === "ai/react" || args.path.startsWith("ai/react/")) {
          return { path: args.path, external: true };
        }

        // Mark optional bundle manifest stores as external (they may not exist)
        if (
          args.path.includes("bundle-manifest-kv") ||
          args.path.includes("bundle-manifest-redis")
        ) {
          return { path: args.path, external: true };
        }

        // Handle relative imports from files in the import-map namespace
        if (args.namespace === "import-map" && args.path.startsWith(".")) {
          // Resolve relative to the importer's directory
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

        // Skip already resolved absolute paths (but not from import-map namespace)
        if (isAbsolute(args.path) && args.namespace !== "import-map") {
          return undefined;
        }

        // Check if this matches any import map entry
        let resolvedPath: string | undefined;

        // First check for exact match
        if (importMap[args.path]) {
          resolvedPath = importMap[args.path];
        } else {
          // Check for prefix match (e.g., "veryfront/ai/" matches "veryfront/ai/xyz")
          for (const [key, value] of Object.entries(importMap)) {
            if (key.endsWith("/") && args.path.startsWith(key)) {
              const suffix = args.path.slice(key.length);
              resolvedPath = value + suffix;
              break;
            }
          }
        }

        if (resolvedPath) {
          // If resolved path is an HTTP(S) URL, let it pass through to be handled by HTTP plugin
          if (resolvedPath.startsWith("http://") || resolvedPath.startsWith("https://")) {
            logger.debug(`[API] Import map resolved to HTTP URL: ${args.path} -> ${resolvedPath}`);
            return undefined; // Let HTTP plugin handle it
          }

          // Resolve relative to project directory
          const absolutePath = isAbsolute(resolvedPath)
            ? resolvedPath
            : resolve(projectDir, resolvedPath);

          logger.debug(`[API] Import map resolved: ${args.path} -> ${absolutePath}`);

          return {
            path: absolutePath,
            namespace: "import-map",
          };
        }

        // Not in import map, let esbuild handle it normally
        return undefined;
      });

      // Load files from the resolved paths using adapter
      build.onLoad({ filter: /.*/, namespace: "import-map" }, async (args) => {
        try {
          let filePath = args.path;
          let contents = "";

          // Try to read the file, if it fails, try adding extensions
          try {
            contents = await adapter.fs.readFile(filePath);
          } catch {
            // File doesn't exist, try adding extensions
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
                // Try next extension
              }
            }

            if (!found) {
              throw toError(createError({
                type: "file",
                message: `File not found: ${filePath}`,
              }));
            }
          }

          // Determine loader based on file extension
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
            : "js"; // default

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

  // Create plugins array with import map plugin first (higher priority)
  const plugins = [
    createImportMapPlugin(projectDir, adapter, config),
    createHTTPPlugin(allowedHosts),
  ];

  // Mark common external packages that should not be bundled
  const externalPackages = [
    "ai",
    "ai/*",
    "ai/react", // Explicitly exclude React hooks (client-side only)
    "@ai-sdk/*",
    "zod",
    "node:*",
    "std/*", // Deno standard library
    "@std/*", // Deno standard library (new format)
    "https://deno.land/*",
  ];

  const result: BuildResult = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022", // Support top-level await
    jsx: "automatic",
    jsxImportSource: "react",
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
    external: externalPackages,
    stdin: {
      contents: source,
      loader,
      resolveDir: projectDir,
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

  return await loadModuleFromCode(js, adapter);
}

async function loadModuleFromCode(code: string, adapter: RuntimeAdapter): Promise<APIRoute> {
  const tempDir = await createTempDir(adapter);
  const tempFile = join(tempDir, "handler.mjs");

  // Rewrite bare specifiers to npm: specifiers for Deno compatibility
  // This allows dynamic imports to work without requiring an import map
  const transformedCode = rewriteExternalImports(code);

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

/**
 * Rewrites bare import specifiers to npm: specifiers for Deno runtime
 * This transforms: import { x } from "@ai-sdk/anthropic"
 * Into: import { x } from "npm:@ai-sdk/anthropic@latest"
 *
 * Note: ai/react is intentionally excluded as it's client-side only and marked as external
 */
function rewriteExternalImports(code: string): string {
  const externalPackages = [
    // Base ai package (but exclude ai/react which is client-side only)
    { pattern: /from\s+["']ai["']/g, replacement: 'from "npm:ai@latest"' },

    // AI SDK provider packages
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

    // Validation library
    { pattern: /from\s+["']zod["']/g, replacement: 'from "npm:zod@latest"' },

    // Also handle dynamic imports
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

  let transformed = code;
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
