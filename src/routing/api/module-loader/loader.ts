import { serverLogger } from "#veryfront/utils";
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
import { wrapWithCurrentContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";

const logger = serverLogger.component("api");

/** Node.js built-in module names — shared across the CJS shim, esbuild externals, and Deno rewrites. */
const NODE_BUILTINS = [
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
] as const;

async function readProjectDependencies(
  projectDir: string,
  fs: FileSystem,
): Promise<Map<string, string>> {
  try {
    const content = await fs.readTextFile(pathHelper.join(projectDir, "package.json"));
    const pkg = JSON.parse(content) as { dependencies?: Record<string, string> };
    return new Map(Object.entries(pkg.dependencies ?? {}));
  } catch {
    return new Map();
  }
}

/**
 * Generates a CJS module loader shim for compiled Deno binaries.
 *
 * In compiled binaries, `createRequire()` can resolve module paths and load
 * built-in modules (fs, path, etc.), but cannot load CJS files from disk
 * (loadMaybeCjs fails with "path not found"). This shim works around that
 * limitation by using `Deno.readTextFileSync` to read CJS files and
 * `new Function` to evaluate them in a proper CJS wrapper with require,
 * exports, module, __filename, and __dirname bindings.
 */
function generateCompiledBinaryRequireShim(escapedProjectDir: string): string {
  const builtinSet = JSON.stringify(NODE_BUILTINS);

  return `
import { createRequire as __vf_createRequire } from "node:module";
import { dirname as __vf_dirname, resolve as __vf_resolve } from "node:path";
var __vf_builtinRequire = __vf_createRequire("${escapedProjectDir}/package.json");
var __vf_builtinSet = new Set(${builtinSet});
var __vf_cache = Object.create(null);
function __vf_loadCjs(id, parentDir) {
  if (id.startsWith("node:")) return __vf_builtinRequire(id);
  if (__vf_builtinSet.has(id)) return __vf_builtinRequire(id);
  var slashIdx = id.indexOf("/");
  if (slashIdx > 0 && __vf_builtinSet.has(id.slice(0, slashIdx))) return __vf_builtinRequire(id);
  var resolved;
  if (id.startsWith(".") || id.startsWith("/")) {
    resolved = __vf_resolve(parentDir, id);
    if (!resolved.match(/\\.[a-zA-Z0-9]+$/)) {
      var exts = [".js", ".cjs", ".json", "/index.js", "/index.cjs", "/index.json"];
      for (var i = 0; i < exts.length; i++) {
        try { Deno.statSync(resolved + exts[i]); resolved += exts[i]; break; } catch {}
      }
    }
  } else {
    resolved = __vf_builtinRequire.resolve(id);
  }
  if (resolved in __vf_cache) return __vf_cache[resolved];
  var code = Deno.readTextFileSync(resolved);
  if (resolved.endsWith(".json")) {
    var json = JSON.parse(code);
    __vf_cache[resolved] = json;
    return json;
  }
  var mod = { exports: {} };
  __vf_cache[resolved] = mod.exports;
  var dir = __vf_dirname(resolved);
  var childReq = function(childId) { return __vf_loadCjs(childId, dir); };
  childReq.resolve = function(childId) {
    if (childId.startsWith(".") || childId.startsWith("/")) return __vf_resolve(dir, childId);
    return __vf_builtinRequire.resolve(childId);
  };
  childReq.ensure = function(mods, cb) { cb(); };
  var fn = new Function("exports", "require", "module", "__filename", "__dirname", "global", "globalThis", "Worker", code);
  fn(mod.exports, childReq, mod, resolved, dir, globalThis, globalThis, undefined);
  __vf_cache[resolved] = mod.exports;
  return mod.exports;
}
function __vf_interopDefault(m) { return m && m.__esModule && m.default !== undefined ? m.default : m; }
var require = function(id) { return __vf_loadCjs(id, "${escapedProjectDir}"); };
require.resolve = function(id) { return __vf_builtinRequire.resolve(id); };
require.ensure = function(mods, cb) { cb(); };
`.trim();
}

function resolveExportEntry(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    // Prefer import > default > first string value
    for (const key of ["import", "default"]) {
      const val = obj[key];
      if (typeof val === "string") return val;
      if (val && typeof val === "object") {
        const nested = val as Record<string, unknown>;
        if (typeof nested.default === "string") return nested.default;
      }
    }
  }
  return undefined;
}

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

    logger.debug(`File not local, using adapter-based loading: ${modulePath}`);
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

  logger.debug(`Direct import (Deno): ${url}`);
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

  logger.info(`Using import map with ${importMapEntries.length} entries`);

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
          logger.debug(`Import map resolved to HTTP URL: ${args.path} -> ${resolvedPath}`);
          return undefined;
        }

        const absolutePath = pathHelper.isAbsolute(resolvedPath)
          ? resolvedPath
          : pathHelper.resolve(projectDir, resolvedPath);

        logger.debug(`Import map resolved: ${args.path} -> ${absolutePath}`);

        return { path: absolutePath, namespace: "import-map" };
      });

      build.onLoad(
        { filter: /.*/, namespace: "import-map" },
        wrapWithCurrentContext(async (args) => {
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
            logger.error(`Failed to load file via import map: ${args.path}`, error);
            return { errors: [{ text: `Failed to load: ${msg}` }] };
          }
        }),
      );
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

      // Wrap the onLoad callback with wrapWithCurrentContext to preserve the
      // AsyncLocalStorage context. esbuild runs in a child process and its plugin
      // callbacks fire from the child process message handler, losing the
      // AsyncLocalStorage store. Without this, MultiProjectFSAdapter.getAdapter()
      // cannot resolve the per-project adapter and all file reads fail silently.
      build.onLoad(
        { filter: /.*/, namespace: "vf-adapter" },
        wrapWithCurrentContext(async (args) => {
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
            logger.error(`Failed to load via adapter: ${args.path}`, error);
            return { errors: [{ text: `Failed to load: ${msg}` }] };
          }
        }),
      );
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

      const allDeps = await readProjectDependencies(projectDir, fs);

      // Filter out framework-managed packages from user deps. These are already
      // handled by the framework's own external/rewrite logic and should not be
      // treated as user npm packages.
      const frameworkPackages = new Set(["ai", "zod", "veryfront", "react", "react-dom", "path"]);
      const frameworkPrefixes = ["@ai-sdk/", "@opentelemetry/", "node:", "veryfront/"];
      const userDeps = new Map<string, string>();
      for (const [name, version] of allDeps) {
        if (frameworkPackages.has(name)) continue;
        if (frameworkPrefixes.some((p) => name.startsWith(p))) continue;
        userDeps.set(name, version);
      }

      // Always externalize user npm dependencies. The bundled handler is loaded
      // from a temp file and user deps are resolved at runtime:
      //   - Node.js: via file:// URLs pointing to node_modules
      //   - Deno (compiled or not): via createRequire or npm: specifiers
      // Bundling CJS deps inline (especially complex ones like pdf-parse/pdf.js)
      // breaks their internal global state management during esbuild's CJS→ESM
      // conversion.
      const userExternals: string[] = [];
      for (const name of userDeps.keys()) {
        userExternals.push(name, `${name}/*`);
      }

      const { build } = await import("esbuild");

      // Many npm packages use CJS require() for Node built-ins (e.g. require('fs')).
      // When esbuild bundles CJS into ESM output, these become __require() shims that
      // fail at runtime. Inject a createRequire-based shim so require() works in ESM.
      // Use projectDir as the resolve base so require() finds the project's node_modules.
      const escapedProjectDir = projectDir.replace(/\\/g, "\\\\");
      const requireShim = isDeno && isCompiledBinary()
        ? generateCompiledBinaryRequireShim(escapedProjectDir)
        : [
          'import { createRequire as __vf_createRequire } from "node:module";',
          `var require = __vf_createRequire("${escapedProjectDir}/package.json");`,
        ].join("\n");

      const result: BuildResult = await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        target: "es2022",
        jsx: "automatic",
        jsxImportSource: "react",
        resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
        banner: { js: requireShim },
        external: [
          "ai",
          "ai/*",
          "ai/react",
          "@ai-sdk/*",
          "zod",
          "node:*",
          ...NODE_BUILTINS,
          "veryfront",
          "veryfront/*",
          "@opentelemetry/*",
          ...userExternals,
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

      logger.info(`built handler ${resolvedPath}`);
      const js = result.outputFiles?.[0]?.text ?? "export {}";
      logger.debug(`transpiled size ${js.length} bytes`);

      return loadModuleFromCode(js, projectDir, fs, userDeps);
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
  userDeps: Map<string, string> = new Map(),
): Promise<APIRoute> {
  const tempDir = await fs.makeTempDir({ prefix: "vf-api-" });
  const tempFile = pathHelper.join(tempDir, "handler.mjs");

  const transformedCode = await rewriteExternalImports(code, projectDir, fs, userDeps);

  // In compiled Deno binaries, external modules loaded from temp files cannot
  // resolve "veryfront" since the source is embedded in the binary's virtual FS.
  // Write runtime shims: a root shim for `from "veryfront"` and per-subpath shims
  // for `from "veryfront/xxx"` (e.g., middleware, workflow, tool).
  if (isDeno && isCompiledBinary()) {
    // Ensure agent factory globalThis bridge is registered before loading user code.
    await import("#veryfront/agent/factory.ts");

    // Write root shim for `from "veryfront"` → "./_vf_runtime.mjs"
    await fs.writeTextFile(
      pathHelper.join(tempDir, "_vf_runtime.mjs"),
      VERYFRONT_RUNTIME_SHIM,
    );

    // Discover which veryfront/* subpaths the user code imports, register the
    // real modules on globalThis, and write per-subpath shim files.
    const subpaths = extractSubpathsFromCode(transformedCode);
    if (subpaths.size > 0) {
      await registerVfModules(subpaths);

      for (const subpath of subpaths) {
        const shimName = `_vf_${subpath.replace(/\//g, "_")}.mjs`;
        const shimCode = generateSubpathShim(subpath);
        await fs.writeTextFile(pathHelper.join(tempDir, shimName), shimCode);
      }
    }

    // Note: user npm dependencies are externalized and loaded at runtime via
    // a custom CJS loader (see generateCompiledBinaryRequireShim), no shims needed.
  }

  await fs.writeTextFile(tempFile, transformedCode);

  try {
    return await import(`file://${tempFile}?v=${Date.now()}`);
  } catch (e: unknown) {
    const errorMessage = e instanceof Error && e.stack ? e.stack : String(e);
    logger.error(`dynamic import failed ${tempFile}: ${errorMessage}`);
    throw e;
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

async function rewriteExternalImports(
  code: string,
  projectDir: string,
  fs: FileSystem,
  userDeps: Map<string, string> = new Map(),
): Promise<string> {
  let transformed = code;

  if (isNode) {
    try {
      const { pathToFileURL } = await import("node:url");

      logger.debug(`Rewriting external imports for Node.js, projectDir: ${projectDir}`);

      const resolvePackageToFileUrl = async (packageName: string): Promise<string | null> => {
        const packagePath = pathHelper.join(projectDir, "node_modules", packageName);
        const packageJsonPath = pathHelper.join(packagePath, "package.json");

        try {
          const pkgJson = JSON.parse(await fs.readTextFile(packageJsonPath));
          let entryPoint: string | undefined;

          if (pkgJson.exports) {
            entryPoint = resolveExportEntry(pkgJson.exports["."]);
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

      for (const name of userDeps.keys()) {
        if (!externalPackagesToResolve.includes(name)) {
          externalPackagesToResolve.push(name);
        }
      }

      for (const pkg of externalPackagesToResolve) {
        const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        // Match both exact imports (from "pkg") and subpath imports (from "pkg/sub")
        const staticImportRegex = new RegExp(`from\\s*["']${escapedPkg}(/[^"']*)?["']`, "g");
        const dynamicImportRegex = new RegExp(
          `import\\s*\\(\\s*["']${escapedPkg}(/[^"']*)?["']\\s*\\)`,
          "g",
        );

        const needsStatic = staticImportRegex.test(transformed);
        staticImportRegex.lastIndex = 0;
        const needsDynamic = dynamicImportRegex.test(transformed);
        dynamicImportRegex.lastIndex = 0;
        if (!needsStatic && !needsDynamic) continue;

        const packageDir = pathToFileURL(pathHelper.join(projectDir, "node_modules", pkg)).href;
        const resolvedUrl = await resolvePackageToFileUrl(pkg);

        if (needsStatic) {
          transformed = transformed.replace(staticImportRegex, (_, subpath) => {
            if (subpath) {
              const subUrl = `${packageDir}${subpath}`;
              logger.debug(`Resolved ${pkg}${subpath} -> ${subUrl}`);
              return `from "${subUrl}"`;
            }
            if (!resolvedUrl) return `from "${pkg}"`;
            logger.debug(`Resolved ${pkg} -> ${resolvedUrl}`);
            return `from "${resolvedUrl}"`;
          });
        }

        if (needsDynamic) {
          transformed = transformed.replace(dynamicImportRegex, (_, subpath) => {
            if (subpath) {
              const subUrl = `${packageDir}${subpath}`;
              return `import("${subUrl}")`;
            }
            if (!resolvedUrl) return `import("${pkg}")`;
            return `import("${resolvedUrl}")`;
          });
        }
      }

      const vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
      const vfPackageJsonPath = pathHelper.join(vfPackagePath, "package.json");

      let exportsMap: Record<string, { import?: string }> = {};
      try {
        const pkgJson = JSON.parse(await fs.readTextFile(vfPackageJsonPath));
        exportsMap = pkgJson.exports || {};
      } catch {
        logger.debug(`Could not read veryfront package.json: `);
      }

      transformed = transformed.replace(
        /from\s+["'](veryfront\/[^"']+)["']/g,
        (match, fullSpecifier: string) => {
          const subpath = "./" + fullSpecifier.replace("veryfront/", "");
          const exportEntry = exportsMap[subpath];
          if (!exportEntry?.import) {
            logger.warn(`No export found for ${subpath}`);
            return match;
          }

          const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
          logger.debug(`Resolved ${fullSpecifier} -> ${resolvedPath}`);
          return `from "${pathToFileURL(resolvedPath).href}"`;
        },
      );

      transformed = transformed.replace(/from\s+["']veryfront["']/g, () => {
        const exportEntry = exportsMap["."];
        if (!exportEntry?.import) return 'from "veryfront"';

        const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
        logger.debug(`Resolved veryfront -> ${resolvedPath}`);
        return `from "${pathToFileURL(resolvedPath).href}"`;
      });
    } catch (e) {
      logger.warn(`Failed to import node:module: ${e}`);
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

    // Rewrite bare Node.js built-in imports to node: prefix for Deno compatibility.
    // npm packages often use require('fs') / from "fs" without the node: prefix.
    for (const mod of NODE_BUILTINS) {
      const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      transformed = transformed.replace(
        new RegExp(`from\\s+["']${escaped}["']`, "g"),
        `from "node:${mod}"`,
      );
      transformed = transformed.replace(
        new RegExp(`import\\s*\\(\\s*["']${escaped}["']\\s*\\)`, "g"),
        `import("node:${mod}")`,
      );
    }

    // Rewrite user-installed npm dependencies.
    // In non-compiled Deno: use npm: specifiers (resolved by Deno's npm support).
    // In compiled binaries: use the createRequire-based `require` shim (already
    // injected by the esbuild banner) to load CJS packages from node_modules,
    // since npm: specifiers only work for packages embedded at compile time.
    if (isCompiledBinary()) {
      for (const name of userDeps.keys()) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Default imports: import foo from "pkg" → const foo = __vf_interopDefault(require("pkg"))
        // interopDefault unwraps .default for ESM packages transpiled to CJS
        transformed = transformed.replace(
          new RegExp(`import\\s+(\\w+)\\s+from\\s+["']${escaped}["']`, "g"),
          (_, localName) => `const ${localName} = __vf_interopDefault(require("${name}"))`,
        );
        // Named imports: import { a, b } from "pkg" → const { a, b } = require("pkg")
        transformed = transformed.replace(
          new RegExp(`import\\s+(\\{[^}]+\\})\\s+from\\s+["']${escaped}["']`, "g"),
          (_, bindings) => `const ${bindings} = require("${name}")`,
        );
        // Namespace imports: import * as foo from "pkg" → const foo = require("pkg")
        transformed = transformed.replace(
          new RegExp(`import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+["']${escaped}["']`, "g"),
          (_, localName) => `const ${localName} = require("${name}")`,
        );
        // Mixed imports: import foo, { bar } from "pkg"
        transformed = transformed.replace(
          new RegExp(
            `import\\s+(\\w+)\\s*,\\s*(\\{[^}]+\\})\\s+from\\s+["']${escaped}["']`,
            "g",
          ),
          (_, defaultName, bindings) => {
            const tmp = `__vf_tmp_${defaultName}`;
            return `const ${tmp} = require("${name}"); const ${defaultName} = __vf_interopDefault(${tmp}); const ${bindings} = ${tmp}`;
          },
        );
        // Subpath static imports: from "pkg/sub" → require("pkg/sub")
        transformed = transformed.replace(
          new RegExp(
            `import\\s+(\\w+|\\*\\s+as\\s+\\w+|\\{[^}]+\\})\\s+from\\s+["']${escaped}(/[^"']+)["']`,
            "g",
          ),
          (_, binding, subpath) => {
            const name_ = binding.startsWith("*") ? binding.replace(/\*\s+as\s+/, "") : binding;
            return `const ${name_} = require("${name}${subpath}")`;
          },
        );
        // Dynamic imports: import("pkg") → Promise.resolve(require("pkg"))
        transformed = transformed.replace(
          new RegExp(`import\\s*\\(\\s*["']${escaped}(/[^"']*)?["']\\s*\\)`, "g"),
          (_, subpath) => `Promise.resolve(require("${name}${subpath || ""}"))`,
        );
      }
    } else {
      for (const [name, version] of userDeps) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Resolve exact installed version from node_modules (falls back to range)
        let resolvedVersion = version;
        try {
          const pkgPath = pathHelper.join(projectDir, "node_modules", name, "package.json");
          const pkgContent = await fs.readTextFile(pkgPath);
          const pkg = JSON.parse(pkgContent) as { version?: string };
          if (pkg.version) resolvedVersion = pkg.version;
        } catch {
          // Fall back to declared range
        }
        // Static: from "pkg" and from "pkg/sub"
        transformed = transformed.replace(
          new RegExp(`from\\s+["']${escaped}(/[^"']*)?["']`, "g"),
          (_, subpath) => `from "npm:${name}@${resolvedVersion}${subpath || ""}"`,
        );
        // Dynamic: import("pkg") and import("pkg/sub")
        transformed = transformed.replace(
          new RegExp(`import\\s*\\(\\s*["']${escaped}(/[^"']*)?["']\\s*\\)`, "g"),
          (_, subpath) => `import("npm:${name}@${resolvedVersion}${subpath || ""}")`,
        );
      }
    }

    // In compiled binaries, "veryfront" resolves to embedded source that can't be
    // imported from external temp files. Rewrite to use local runtime shims.
    if (isCompiledBinary()) {
      // Static root imports: from "veryfront"
      transformed = transformed.replace(
        /from\s+["']veryfront["']/g,
        'from "./_vf_runtime.mjs"',
      );
      // Dynamic root imports: import("veryfront")
      transformed = transformed.replace(
        /import\s*\(\s*["']veryfront["']\s*\)/g,
        'import("./_vf_runtime.mjs")',
      );
      // Subpath static imports: from "veryfront/agent" → from "./_vf_agent.mjs"
      transformed = transformed.replace(
        /from\s+["']veryfront\/([^"']+)["']/g,
        (_match, subpath: string) => `from "./_vf_${subpath.replace(/\//g, "_")}.mjs"`,
      );
      // Subpath dynamic imports: import("veryfront/agent") → import("./_vf_agent.mjs")
      transformed = transformed.replace(
        /import\s*\(\s*["']veryfront\/([^"']+)["']\s*\)/g,
        (_match, subpath: string) => `import("./_vf_${subpath.replace(/\//g, "_")}.mjs")`,
      );
    }
  }

  return transformed;
}

function extractAPIRouteHandlers(module: unknown): APIRoute | null {
  if (!module || typeof module !== "object") return null;

  const mod = module as Record<string, unknown>;
  const handler: APIRoute = {};
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "default"] as const;
  let found = false;

  for (const method of methods) {
    const fn = mod[method];
    if (typeof fn === "function") {
      handler[method] = fn as APIRoute[typeof method];
      found = true;
    }
  }

  return found ? handler : null;
}

/**
 * Extract veryfront subpath references from transpiled code.
 * After rewriteExternalImports, subpath imports look like `./_vf_<name>.mjs`.
 */
function extractSubpathsFromCode(code: string): Set<string> {
  const subpaths = new Set<string>();

  // Match _vf_<subpath>.mjs patterns (but not _vf_runtime.mjs which is the root)
  const re = /_vf_([a-zA-Z0-9_]+)\.mjs/g;
  let match;
  while ((match = re.exec(code)) !== null) {
    const shimName = match[1] ?? "";
    if (shimName && shimName !== "runtime") {
      subpaths.add(shimName.replace(/_/g, "/"));
    }
  }

  return subpaths;
}

/**
 * Register veryfront modules on globalThis so per-subpath shims can delegate.
 * Imports are from embedded source (works in compiled binaries).
 */
async function registerVfModules(subpaths: Set<string>): Promise<void> {
  const modules = ((globalThis as Record<string, unknown>).__vfModules ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  for (const subpath of subpaths) {
    if (modules[subpath]) continue;

    try {
      const specifier = `veryfront/${subpath}`;
      modules[subpath] = await import(specifier) as Record<string, unknown>;
      logger.debug(`[API] Registered module ${specifier} on globalThis`);
    } catch (e) {
      logger.warn(`[API] Failed to register veryfront/${subpath}: ${e}`);
    }
  }

  (globalThis as Record<string, unknown>).__vfModules = modules;
}

/**
 * Generate an ESM shim for a specific veryfront subpath.
 * Named exports are discovered from the registered module.
 */
function generateSubpathShim(subpath: string): string {
  const modules = (globalThis as Record<string, unknown>).__vfModules as
    | Record<string, Record<string, unknown>>
    | undefined;
  const mod = modules?.[subpath];

  if (!mod) {
    return `throw new Error("veryfront/${subpath} runtime not registered in compiled binary context");`;
  }

  const exportNames = Object.keys(mod).filter((k) => k !== "default" && k !== "__esModule");
  const lines: string[] = [
    `// Auto-generated shim for veryfront/${subpath}`,
    `const _mod = globalThis.__vfModules["${subpath}"];`,
  ];

  for (const name of exportNames) {
    // Use bracket notation to handle reserved words or special names
    lines.push(`export const ${name} = _mod["${name}"];`);
  }

  if ("default" in mod) {
    lines.push(`export default _mod["default"];`);
  }

  return lines.join("\n");
}

/**
 * Runtime shim for the "veryfront" package when running in a compiled Deno binary.
 *
 * In compiled binaries, source files are embedded and can't be imported from
 * external temp files. This shim provides the public API by delegating to
 * globalThis bridges registered by the server's project-env/storage.ts module.
 */
const VERYFRONT_RUNTIME_SHIM = `
// Auto-generated veryfront runtime shim for compiled binary.
// Delegates to real framework functions registered on globalThis by
// the server process (composition.ts, factory.ts, storage.ts).

// --- Environment ---
function getEnv(key) {
  const getter = globalThis.__vfProjectEnvGetter;
  if (getter) {
    const val = getter(key);
    if (val !== undefined) return val;
  }
  const isActive = globalThis.__vfProjectEnvActiveChecker;
  if (isActive && isActive()) return undefined;
  if (typeof Deno !== "undefined") return Deno.env.get(key);
  if (typeof process !== "undefined" && process.env) return process.env[key];
  return undefined;
}

// --- Config ---
function defineConfig(config) { return config; }

// --- HTTP helpers ---
function json(data, init) { return Response.json(data, init); }
function notFound(msg) { return new Response(msg || "Not Found", { status: 404 }); }
function badRequest(msg) { return new Response(msg || "Bad Request", { status: 400 }); }
function unauthorized(msg) { return new Response(msg || "Unauthorized", { status: 401 }); }
function forbidden(msg) { return new Response(msg || "Forbidden", { status: 403 }); }
function serverError(msg) { return new Response(msg || "Internal Server Error", { status: 500 }); }
function redirect(url, permanent) {
  return Response.redirect(url, permanent ? 301 : 302);
}
function apiNotFound(msg) { return notFound(msg); }
function apiRedirect(url, permanent) { return redirect(url, permanent); }

// --- Agent module (veryfront/agent) ---
// Delegates to real implementations registered on globalThis by the server.
function agent(config) {
  const factory = globalThis.__vfAgentFactory;
  if (!factory) throw new Error("Agent runtime not available in this context");
  return factory(config);
}
function getAgent(id) { return globalThis.__vfGetAgent?.(id) ?? undefined; }
function registerAgent(id, agentInstance) { return globalThis.__vfRegisterAgent?.(id, agentInstance); }
function getAllAgentIds() { return globalThis.__vfGetAllAgentIds?.() ?? []; }

export {
  getEnv,
  defineConfig,
  json,
  notFound,
  badRequest,
  unauthorized,
  forbidden,
  serverError,
  redirect,
  apiNotFound,
  apiRedirect,
  agent,
  getAgent,
  registerAgent,
  getAllAgentIds,
};
`;
