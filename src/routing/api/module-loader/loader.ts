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
import { FILE_EXTENSIONS, getLoaderForFile, validateModulePath } from "./loader-helpers.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isCompiledBinary } from "#veryfront/utils";
import { wrapWithCurrentContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import {
  generateCompiledBinaryRequireShim,
  NODE_BUILTINS,
  readProjectDependencies,
  rewriteExternalImports,
} from "./external-import-rewriter.ts";
export {
  generateCompiledBinaryRequireShim,
  getNodeExternalPackagesToResolve,
  loadVeryfrontExportsMap,
  resolveNodePackageToFileUrl,
  rewriteCompiledBinaryUserDependencyImports,
  rewriteCompiledBinaryVeryfrontImports,
  rewriteDenoNodeBuiltinImports,
  rewriteDenoNpmDependencyImports,
  rewriteNodeExternalImports,
} from "./external-import-rewriter.ts";

const logger = serverLogger.component("api");

export { toCjsDestructureBindings } from "./loader-helpers.ts";

export function loadHandlerModule(options: LoadModuleOptions): Promise<APIRoute | null> {
  return withSpan(
    "api.loadHandlerModule",
    async () => {
      const { projectDir, modulePath, adapter, config } = options;
      const fs = createFileSystem();

      validateModulePath(modulePath, projectDir);

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

async function loadModule(args: {
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

  const fileExistsLocally = await fs.exists(modulePath);
  if (fileExistsLocally) return loadTSModuleDirect(modulePath);

  logger.debug(`File not local, using adapter-based loading: ${modulePath}`);
  return loadAndTranspileModule(modulePath, projectDir, adapter, fs, config);
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

        if (!isWithinDirectory(pathHelper.resolve(projectDir), absolutePath)) {
          logger.error(
            `[API] Import map entry escapes project directory: ${args.path} -> ${absolutePath}`,
          );
          return { errors: [{ text: `Import map path escapes project: ${args.path}` }] };
        }

        logger.debug(`Import map resolved: ${args.path} -> ${absolutePath}`);

        return { path: absolutePath, namespace: "import-map" };
      });

      build.onLoad(
        { filter: /.*/, namespace: "import-map" },
        createNamespaceOnLoadHandler({
          adapter,
          projectDir,
          errorLabel: "file via import map",
        }),
      );
    },
  };
}

function createNamespaceOnLoadHandler(options: {
  adapter: RuntimeAdapter;
  projectDir: string;
  errorLabel: string;
}) {
  const { adapter, projectDir, errorLabel } = options;

  return wrapWithCurrentContext(async (args: { path: string }) => {
    try {
      const { filePath, contents } = await readFileWithExtensions(
        adapter,
        args.path,
        FILE_EXTENSIONS,
        projectDir,
      );

      return {
        contents,
        loader: getLoaderForFile(filePath),
        resolveDir: pathHelper.dirname(filePath),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to load ${errorLabel}: ${args.path}`, error);
      return { errors: [{ text: `Failed to load: ${msg}` }] };
    }
  });
}

/** Resolves relative imports through the adapter's virtual FS for remote projects. */
function createAdapterResolvePlugin(
  adapter: RuntimeAdapter,
  projectDir: string,
): Plugin {
  return {
    name: "vf-adapter-resolve",
    setup(build) {
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        if (args.namespace === "http-url" || args.namespace === "import-map") return undefined;

        const baseDir = args.importer ? pathHelper.dirname(args.importer) : args.resolveDir;
        if (!baseDir) return undefined;

        const absolutePath = pathHelper.resolve(baseDir, args.path);

        if (!isWithinDirectory(pathHelper.resolve(projectDir), absolutePath)) {
          logger.error(
            `[API] Adapter resolve path escapes project: ${args.path} -> ${absolutePath}`,
          );
          return {
            errors: [{ text: `Relative import escapes project: ${args.path}` }],
          };
        }

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
        createNamespaceOnLoadHandler({
          adapter,
          projectDir,
          errorLabel: "via adapter",
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
        projectDir,
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
      const frameworkPackages = new Set(["zod", "veryfront", "react", "react-dom", "path"]);
      const frameworkPrefixes = ["@opentelemetry/", "node:", "veryfront/"];
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
      const safeProjectDir = JSON.stringify(projectDir + "/package.json");
      const requireShim = isDeno && isCompiledBinary()
        ? generateCompiledBinaryRequireShim(projectDir)
        : [
          'import { createRequire as __vf_createRequire } from "node:module";',
          `var require = __vf_createRequire(${safeProjectDir});`,
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
          createAdapterResolvePlugin(adapter, projectDir),
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
  projectDir?: string,
): Promise<{ filePath: string; contents: string }> {
  const resolvedProjectDir = projectDir ? pathHelper.resolve(projectDir) : undefined;

  for (const ext of extensions) {
    const filePath = ext ? basePath + ext : basePath;

    if (resolvedProjectDir) {
      const resolved = pathHelper.resolve(filePath);
      if (!isWithinDirectory(resolvedProjectDir, resolved)) {
        throw toError(
          createError({
            type: "api",
            message: `[API] file path escapes project directory: ${filePath}`,
          }),
        );
      }
    }

    try {
      const contents = await adapter.fs.readFile(filePath);
      return { filePath, contents };
    } catch (_) {
      /* expected: trying next file extension candidate */
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

  // __VERYFRONT_MODULES__ is populated by the discovery transpiler via hash
  // imports (#veryfront/...) which resolve correctly in compiled binaries.
  // Check it first before attempting bare specifier dynamic imports.
  const discoveryModules = (globalThis as Record<string, unknown>).__VERYFRONT_MODULES__ as
    | Record<string, Record<string, unknown>>
    | undefined;

  for (const subpath of subpaths) {
    if (modules[subpath]) continue;

    const specifier = `veryfront/${subpath}`;

    const fromDiscovery = discoveryModules?.[specifier];
    if (fromDiscovery) {
      modules[subpath] = fromDiscovery;
      logger.debug(`[API] Registered module ${specifier} from discovery globals`);
      continue;
    }

    try {
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
