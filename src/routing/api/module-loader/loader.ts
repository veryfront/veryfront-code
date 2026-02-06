import { serverLogger as logger } from "#veryfront/utils";
import type { BuildResult, Plugin } from "esbuild";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createHTTPPlugin } from "./esbuild-plugin.ts";
import { validateHTTPImports } from "./http-validator.ts";
import { loadSecurityConfig } from "./security-config.ts";
import type { APIRoute, LoadModuleOptions } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isCompiledBinary } from "#veryfront/utils";

const FILE_EXTENSIONS: string[] = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];

const EXT_TO_LOADER: Record<string, "tsx" | "jsx" | "ts" | "js" | "json"> = {
  tsx: "tsx",
  jsx: "jsx",
  ts: "ts",
  json: "json",
};

function getLoaderForFile(filePath: string): "tsx" | "jsx" | "ts" | "js" | "json" {
  const ext = filePath.split(".").pop() ?? "";
  return EXT_TO_LOADER[ext] ?? "js";
}

export function loadHandlerModule(options: LoadModuleOptions): Promise<APIRoute | null> {
  return withSpan(
    "api.loadHandlerModule",
    async () => {
      const { projectDir, modulePath, adapter, config } = options;
      const fs = createFileSystem();

      try {
        const module = await loadModule({ modulePath, projectDir, adapter, fs, config });
        return extractAPIRouteHandlers(module);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to load API handler ${modulePath}:`, error);
        throw toError(
          createError({
            type: "api",
            message: `Failed to load API handler: ${errorMsg}`,
          }),
        );
      }
    },
    { "api.modulePath": options.modulePath, "api.projectDir": options.projectDir },
  );
}

function loadModule(args: {
  modulePath: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  fs: FileSystem;
  config?: VeryfrontConfig;
}): Promise<APIRoute> {
  const { modulePath, projectDir, adapter, fs, config } = args;

  if (modulePath.endsWith(".js")) return loadJSModule(modulePath);

  // Always transpile TypeScript in compiled binaries - they can't import raw .ts files
  if (!isDeno || isCompiledBinary()) {
    return loadAndTranspileModule(modulePath, projectDir, adapter, fs, config);
  }

  return fs.exists(modulePath).then((fileExistsLocally) => {
    if (fileExistsLocally) return loadTSModuleDirect(modulePath);

    logger.debug(`[API] File not local, using adapter-based loading: ${modulePath}`);
    return loadAndTranspileModule(modulePath, projectDir, adapter, fs, config);
  });
}

/**
 * Directly import a TypeScript module in Deno without bundling.
 * This allows the module to share the same runtime context as the dev server,
 * enabling auto-discovery features like agentRegistry to work.
 */
function loadTSModuleDirect(modulePath: string): Promise<APIRoute> {
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
  const importMap = config?.resolve?.importMap?.imports ?? {};
  const importMapEntries = Object.keys(importMap);

  if (importMapEntries.length === 0) return { name: "import-map", setup() {} };

  logger.info(`[API] Using import map with ${importMapEntries.length} entries`);

  return {
    name: "import-map",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith("http://") || args.path.startsWith("https://")) return undefined;
        if (args.path.startsWith("node:")) return { path: args.path, external: true };
        if (args.path === "ai/react" || args.path.startsWith("ai/react/")) {
          return { path: args.path, external: true };
        }

        if (
          args.path.includes("bundle-manifest-kv") || args.path.includes("bundle-manifest-redis")
        ) {
          return { path: args.path, external: true };
        }

        if (args.namespace === "import-map" && args.path.startsWith(".")) {
          const importerDir = pathHelper.dirname(args.importer);
          const absolutePath = pathHelper.resolve(importerDir, args.path);

          logger.debug(
            `[API] Import map relative resolve: ${args.path} (from ${args.importer}) -> ${absolutePath}`,
          );

          return { path: absolutePath, namespace: "import-map" };
        }

        if (pathHelper.isAbsolute(args.path) && args.namespace !== "import-map") return undefined;

        let resolvedPath = importMap[args.path];
        if (!resolvedPath) {
          for (const [key, value] of Object.entries(importMap)) {
            if (key.endsWith("/") && args.path.startsWith(key)) {
              resolvedPath = value + args.path.slice(key.length);
              break;
            }
          }
        }

        if (!resolvedPath) return undefined;

        if (resolvedPath.startsWith("http://") || resolvedPath.startsWith("https://")) {
          logger.debug(`[API] Import map resolved to HTTP URL: ${args.path} -> ${resolvedPath}`);
          return undefined;
        }

        const absolutePath = pathHelper.isAbsolute(resolvedPath)
          ? resolvedPath
          : pathHelper.resolve(projectDir, resolvedPath);

        logger.debug(`[API] Import map resolved: ${args.path} -> ${absolutePath}`);

        return { path: absolutePath, namespace: "import-map" };
      });

      build.onLoad({ filter: /.*/, namespace: "import-map" }, async (args) => {
        try {
          const { filePath, contents } = await readFileWithExtensions(
            adapter,
            args.path,
            FILE_EXTENSIONS,
          );

          return {
            contents,
            loader: getLoaderForFile(filePath),
            resolveDir: pathHelper.dirname(filePath),
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error(`[API] Failed to load file via import map: ${args.path}`, error);
          return { errors: [{ text: `Failed to load: ${msg}` }] };
        }
      });
    },
  };
}

/** Resolves relative imports through the adapter's virtual FS for remote projects. */
function createAdapterResolvePlugin(adapter: RuntimeAdapter): Plugin {
  return {
    name: "vf-adapter-resolve",
    setup(build) {
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        if (args.namespace === "http-url" || args.namespace === "import-map") return undefined;

        const baseDir = args.importer ? pathHelper.dirname(args.importer) : args.resolveDir;
        if (!baseDir) return undefined;

        const absolutePath = pathHelper.resolve(baseDir, args.path);
        logger.debug(
          `[API] Adapter resolve: ${args.path} (from ${
            args.importer || "stdin"
          }) -> ${absolutePath}`,
        );
        return { path: absolutePath, namespace: "vf-adapter" };
      });

      build.onLoad({ filter: /.*/, namespace: "vf-adapter" }, async (args) => {
        try {
          const { filePath, contents } = await readFileWithExtensions(
            adapter,
            args.path,
            FILE_EXTENSIONS,
          );

          return {
            contents,
            loader: getLoaderForFile(filePath),
            resolveDir: pathHelper.dirname(filePath),
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error(`[API] Failed to load via adapter: ${args.path}`, error);
          return { errors: [{ text: `Failed to load: ${msg}` }] };
        }
      });
    },
  };
}

function loadAndTranspileModule(
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  fs: FileSystem,
  config?: VeryfrontConfig,
): Promise<APIRoute> {
  return withSpan(
    "api.loadAndTranspileModule",
    async () => {
      const { filePath: resolvedPath, contents: source } = await readFileWithExtensions(
        adapter,
        modulePath,
        FILE_EXTENSIONS,
      );

      if (!source) {
        throw toError(
          createError({
            type: "file",
            message: `File not found: ${modulePath} (tried extensions: .ts, .tsx, .js, .jsx, .mjs)`,
          }),
        );
      }

      const loader = getEsbuildLoader(resolvedPath);

      const allowedHosts = await loadSecurityConfig(projectDir, adapter);
      validateHTTPImports(source, allowedHosts);

      const { build } = await import("esbuild");

      const result: BuildResult = await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        target: "es2022",
        jsx: "automatic",
        jsxImportSource: "react",
        resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
        external: [
          "ai",
          "ai/*",
          "ai/react",
          "@ai-sdk/*",
          "zod",
          "node:*",
          "veryfront",
          "veryfront/*",
          "@opentelemetry/*",
          "path",
        ],
        stdin: {
          contents: source,
          loader,
          resolveDir: pathHelper.dirname(resolvedPath),
          sourcefile: resolvedPath,
        },
        plugins: [
          createImportMapPlugin(projectDir, adapter, config),
          createAdapterResolvePlugin(adapter),
          createHTTPPlugin(allowedHosts),
        ],
      });

      if (result.errors?.length) {
        const first = result.errors[0]?.text || "unknown error";
        throw toError(
          createError({
            type: "api",
            message: `[API] handler build failed: ${first}`,
          }),
        );
      }

      logger.info(`[API] built handler ${resolvedPath}`);
      const js = result.outputFiles?.[0]?.text ?? "export {}";
      logger.debug(`[API] transpiled size ${js.length} bytes`);

      return loadModuleFromCode(js, projectDir, fs);
    },
    { "api.modulePath": modulePath, "api.projectDir": projectDir },
  );
}

async function readFileWithExtensions(
  adapter: RuntimeAdapter,
  basePath: string,
  extensions: string[],
): Promise<{ filePath: string; contents: string }> {
  for (const ext of extensions) {
    const filePath = ext ? basePath + ext : basePath;
    try {
      const contents = await adapter.fs.readFile(filePath);
      return { filePath, contents };
    } catch {
      // try next
    }
  }

  throw toError(
    createError({
      type: "file",
      message: `File not found: ${basePath}`,
    }),
  );
}

async function loadModuleFromCode(
  code: string,
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

  if (isNode) {
    try {
      const { pathToFileURL } = await import("node:url");

      logger.debug(`[API] Rewriting external imports for Node.js, projectDir: ${projectDir}`);

      const resolvePackageToFileUrl = async (packageName: string): Promise<string | null> => {
        const packagePath = pathHelper.join(projectDir, "node_modules", packageName);
        const packageJsonPath = pathHelper.join(packagePath, "package.json");

        try {
          const pkgJson = JSON.parse(await fs.readTextFile(packageJsonPath));
          let entryPoint: string | undefined;

          if (pkgJson.exports) {
            const dotExport = pkgJson.exports["."];
            if (typeof dotExport === "string") entryPoint = dotExport;
            else if (dotExport?.import) entryPoint = dotExport.import;
            else if (dotExport?.default) entryPoint = dotExport.default;
          }

          entryPoint ||= pkgJson.module || pkgJson.main || "index.js";
          if (!entryPoint) return null;

          return pathToFileURL(pathHelper.join(packagePath, entryPoint)).href;
        } catch {
          return null;
        }
      };

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

      for (const pkg of externalPackagesToResolve) {
        const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const staticImportRegex = new RegExp(`from\\s*["']${escapedPkg}["']`, "g");
        const dynamicImportRegex = new RegExp(`import\\s*\\(\\s*["']${escapedPkg}["']\\s*\\)`, "g");

        const needsStatic = staticImportRegex.test(transformed);
        const needsDynamic = dynamicImportRegex.test(transformed);
        if (!needsStatic && !needsDynamic) continue;

        const resolvedUrl = await resolvePackageToFileUrl(pkg);
        if (!resolvedUrl) continue;

        if (needsStatic) {
          transformed = transformed.replace(staticImportRegex, `from "${resolvedUrl}"`);
          logger.debug(`[API] Resolved ${pkg} -> ${resolvedUrl}`);
        }

        if (needsDynamic) {
          transformed = transformed.replace(dynamicImportRegex, `import("${resolvedUrl}")`);
          logger.debug(`[API] Resolved dynamic import ${pkg} -> ${resolvedUrl}`);
        }
      }

      const vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
      const vfPackageJsonPath = pathHelper.join(vfPackagePath, "package.json");

      let exportsMap: Record<string, { import?: string }> = {};
      try {
        const pkgJson = JSON.parse(await fs.readTextFile(vfPackageJsonPath));
        exportsMap = pkgJson.exports || {};
      } catch {
        logger.debug(`[API] Could not read veryfront package.json: `);
      }

      transformed = transformed.replace(
        /from\s+["'](veryfront\/[^"']+)["']/g,
        (match, fullSpecifier: string) => {
          const subpath = "./" + fullSpecifier.replace("veryfront/", "");
          const exportEntry = exportsMap[subpath];
          if (!exportEntry?.import) {
            logger.warn(`[API] No export found for ${subpath}`);
            return match;
          }

          const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
          logger.debug(`[API] Resolved ${fullSpecifier} -> ${resolvedPath}`);
          return `from "${pathToFileURL(resolvedPath).href}"`;
        },
      );

      transformed = transformed.replace(/from\s+["']veryfront["']/g, () => {
        const exportEntry = exportsMap["."];
        if (!exportEntry?.import) return 'from "veryfront"';

        const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
        logger.debug(`[API] Resolved veryfront -> ${resolvedPath}`);
        return `from "${pathToFileURL(resolvedPath).href}"`;
      });
    } catch (e) {
      logger.warn(`[API] Failed to import node:module: ${e}`);
    }
  }

  if (isDeno) {
    const rewrites = [
      { pattern: /from\s+["']ai["']/g, replacement: 'from "npm:ai@latest"' },
      {
        pattern: /from\s+["']@ai-sdk\/anthropic["']/g,
        replacement: 'from "npm:@ai-sdk/anthropic@latest"',
      },
      {
        pattern: /from\s+["']@ai-sdk\/openai["']/g,
        replacement: 'from "npm:@ai-sdk/openai@latest"',
      },
      {
        pattern: /from\s+["']@ai-sdk\/google["']/g,
        replacement: 'from "npm:@ai-sdk/google@latest"',
      },
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

    for (const { pattern, replacement } of rewrites) {
      transformed = transformed.replace(pattern, replacement);
    }
  }

  return transformed;
}

function extractAPIRouteHandlers(module: unknown): APIRoute {
  if (!module || typeof module !== "object") return {};

  const mod = module as Record<string, unknown>;
  const handler: APIRoute = {};
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "default"] as const;

  for (const method of methods) {
    const fn = mod[method];
    if (typeof fn === "function") handler[method] = fn as APIRoute[typeof method];
  }

  return handler;
}
