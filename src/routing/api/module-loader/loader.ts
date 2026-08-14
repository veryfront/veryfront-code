import { serverLogger } from "#veryfront/utils";
import type { BuildResult, Plugin } from "veryfront/extensions/bundler";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createHTTPPlugin } from "./esbuild-plugin.ts";
import { validateHTTPImports } from "./http-validator.ts";
import { loadSecurityConfig } from "./security-config.ts";
import type { APIRoute, LoadHostModuleOptions, LoadModuleOptions } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
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
import {
  MAX_WORKER_MODULE_SOURCE_BYTES,
  type PreparedWorkerModule,
} from "#veryfront/security/sandbox/worker-types.ts";
import { isExplicitHostProjectCodeExecutionAllowed } from "#veryfront/security/project-locality.ts";
import {
  isIsolatedApiPreparationSupported,
  ISOLATED_API_PREPARATION_UNSUPPORTED_REASON,
} from "#veryfront/security/sandbox/isolation-capability.ts";
import {
  createProjectSourceSnapshot,
  ProjectBoundaryViolationError,
  type ProjectSourceSnapshot,
} from "./project-source-snapshot.ts";
export {
  generateCompiledBinaryRequireShim,
  getNodeExternalPackagesToResolve,
  loadVeryfrontExportsMap,
  resolveEsmUserDependencies,
  resolveNodePackageToFileUrl,
  rewriteCompiledBinaryUserDependencyImports,
  rewriteCompiledBinaryVeryfrontImports,
  rewriteDenoNodeBuiltinImports,
  rewriteDenoNpmDependencyImports,
  rewriteNodeExternalImports,
} from "./external-import-rewriter.ts";

const logger = serverLogger.component("api");

export { toCjsDestructureBindings } from "./loader-helpers.ts";

export function loadHandlerModule(options: LoadHostModuleOptions): Promise<APIRoute | null> {
  if (!isExplicitHostProjectCodeExecutionAllowed(options)) {
    return Promise.reject(
      new TypeError("Host API module loading requires explicit trusted-local execution"),
    );
  }
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

/**
 * Build an API route without importing or evaluating project code in the host
 * realm. Shared runtimes pass this immutable source snapshot to the project
 * worker, which rehashes and evaluates it under tenant-scoped permissions.
 */
export function prepareHandlerModule(options: LoadModuleOptions): Promise<PreparedWorkerModule> {
  return withSpan(
    "api.prepareHandlerModule",
    async () => {
      const { projectDir, modulePath, adapter, config } = options;
      validateModulePath(modulePath, projectDir);

      // Fail-closed backstop. API ownership reports a typed 503 before this.
      if (!isIsolatedApiPreparationSupported()) {
        throw toError(
          createError({
            type: "api",
            message: ISOLATED_API_PREPARATION_UNSUPPORTED_REASON,
          }),
        );
      }

      try {
        const source = await buildTranspiledModuleSource(
          modulePath,
          projectDir,
          adapter,
          config,
        );
        const bytes = new TextEncoder().encode(source);
        if (bytes.byteLength > MAX_WORKER_MODULE_SOURCE_BYTES) {
          throw new TypeError(
            `Prepared API route exceeds the ${MAX_WORKER_MODULE_SOURCE_BYTES}-byte worker limit`,
          );
        }
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return Object.freeze({
          source,
          sha256: new Uint8Array(digest).toHex(),
        });
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to prepare isolated API handler ${modulePath}:`, error);
        throw toError(
          createError({
            type: "api",
            message: `Failed to prepare isolated API handler: ${errorMsg}`,
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
  if (fileExistsLocally) {
    try {
      return await loadTSModuleDirect(modulePath);
    } catch (error) {
      // A direct import shares the dev server's runtime context, which is what
      // makes auto-discovery (agentRegistry and friends) work — but it leaves
      // specifier resolution to Deno, which knows nothing about the project's
      // `@/` alias. Bundling can resolve that import map path, so fall back to
      // it rather than reporting a routing-shaped 500.
      if (!isSpecifierResolutionError(error)) throw error;

      logger.debug("Direct import could not resolve a specifier, bundling instead", {
        modulePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return loadAndTranspileModule(modulePath, projectDir, adapter, fs, config);
    }
  }

  logger.debug(`File not local, using adapter-based loading: ${modulePath}`);
  return loadAndTranspileModule(modulePath, projectDir, adapter, fs, config);
}

/**
 * Directly import a TypeScript module in Deno without bundling.
 * This allows the module to share the same runtime context as the dev server,
 * enabling auto-discovery features like agentRegistry to work.
 */

/**
 * Deno's resolver reports an unresolvable import as a TypeError whose message
 * opens by naming the specifier it could not resolve. Anchoring on that opening
 * is what keeps a module's own error out: a route that throws
 * `Error("Cannot find module x")` at evaluation time is broken, and re-running
 * it under bundling would evaluate broken code a second time.
 */
const SPECIFIER_RESOLUTION_MESSAGE =
  /^(?:Import "[^"]+" not a dependency|Module not found "[^"]+"|Relative import path "[^"]+" not prefixed)/;

/**
 * True when a module failed to load because Deno could not resolve one of its
 * import specifiers, rather than because the module itself is broken.
 */
export function isSpecifierResolutionError(error: unknown): boolean {
  // Every other error shape the direct import can produce belongs to the module.
  if (!(error instanceof TypeError)) return false;
  return SPECIFIER_RESOLUTION_MESSAGE.test(error.message.trimStart());
}

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
  sourceSnapshot: ProjectSourceSnapshot,
  config?: VeryfrontConfig,
): Plugin {
  const importMap = config?.resolve?.importMap?.imports ?? {};
  const importMapEntries = Object.keys(importMap);

  if (importMapEntries.length === 0) return { name: "import-map", setup() {} };

  logger.debug(`Using import map with ${importMapEntries.length} entries`);

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
          sourceSnapshot,
          projectDir,
          errorLabel: "file via import map",
        }),
      );
    },
  };
}

function createNamespaceOnLoadHandler(options: {
  sourceSnapshot: ProjectSourceSnapshot;
  projectDir: string;
  errorLabel: string;
}) {
  const { sourceSnapshot, projectDir, errorLabel } = options;

  return wrapWithCurrentContext(async (args: { path: string }) => {
    try {
      const { filePath, contents } = await readFileWithExtensions(
        sourceSnapshot,
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

/** Resolves the framework's built-in @/ project alias through the runtime adapter. */
function createProjectAliasPlugin(
  sourceSnapshot: ProjectSourceSnapshot,
  projectDir: string,
): Plugin {
  const projectRoot = pathHelper.resolve(projectDir);

  return {
    name: "vf-project-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const absolutePath = pathHelper.resolve(projectRoot, args.path.slice(2));
        if (!isWithinDirectory(projectRoot, absolutePath)) {
          logger.error(
            `[API] Project alias escapes project: ${args.path} -> ${absolutePath}`,
          );
          return { errors: [{ text: `Project alias escapes project: ${args.path}` }] };
        }

        return { path: absolutePath, namespace: "vf-project-alias" };
      });

      build.onLoad(
        { filter: /.*/, namespace: "vf-project-alias" },
        createNamespaceOnLoadHandler({
          sourceSnapshot,
          projectDir,
          errorLabel: "via project alias",
        }),
      );
    },
  };
}

/** Resolves relative imports through the adapter's virtual FS for remote projects. */
function createAdapterResolvePlugin(
  sourceSnapshot: ProjectSourceSnapshot,
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
          sourceSnapshot,
          projectDir,
          errorLabel: "via adapter",
        }),
      );
    },
  };
}

/**
 * Refuse to load any file the bundle resolved outside the project.
 *
 * The resolver plugins above validate the specifiers they claim, but esbuild
 * applies the project's own tsconfig `paths` itself, before any `onResolve`
 * callback runs. A templated project maps `@/*` to `./*`, so `@/../secrets.ts`
 * is resolved by esbuild straight to a path above the project root and loaded
 * in the default namespace, where none of those guards ever see it.
 *
 * The source snapshot canonicalizes both roots and resolved files. Dependencies
 * are admitted only through the project's own canonical `node_modules` root;
 * an unrelated path is never trusted merely because one segment has that name.
 */
function projectBoundaryError(path: string): { errors: Array<{ text: string }> } {
  logger.error(`[API] Resolved import escapes project: ${path}`);
  return {
    errors: [{
      text: `Import escapes the project directory: ${path}. ` +
        `API routes may only import project files and project-owned dependencies.`,
    }],
  };
}

function createProjectBoundaryPlugin(
  sourceSnapshot: ProjectSourceSnapshot,
): Plugin {
  return {
    name: "vf-project-boundary",
    setup(build) {
      build.onLoad({ filter: /.*/ }, async (args) => {
        try {
          const source = await sourceSnapshot.read(args.path);
          return {
            contents: source.contents,
            loader: getLoaderForFile(source.logicalPath),
            resolveDir: pathHelper.dirname(source.logicalPath),
          };
        } catch (error) {
          if (error instanceof ProjectBoundaryViolationError) {
            return projectBoundaryError(args.path);
          }
          const message = error instanceof Error ? error.message : String(error);
          return {
            errors: [{ text: `Failed to read authorized import: ${message}` }],
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
  const source = await buildTranspiledModuleSource(
    modulePath,
    projectDir,
    adapter,
    config,
  );
  return await loadModuleFromCode(source, fs);
}

function buildTranspiledModuleSource(
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
): Promise<string> {
  return withSpan(
    "api.buildTranspiledModuleSource",
    async () => {
      const sourceSnapshot = await createProjectSourceSnapshot(projectDir, adapter);
      const { filePath: resolvedPath, contents: source } = await readFileWithExtensions(
        sourceSnapshot,
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

      const allowedHosts = await loadSecurityConfig(projectDir, adapter, config);
      validateHTTPImports(source, allowedHosts);

      const allDeps = await readProjectDependencies(projectDir, sourceSnapshot);

      // Filter out framework-managed packages from user deps. These are already
      // handled by the framework's own external/rewrite logic and should not be
      // treated as user npm packages.
      //
      // `zod` is kept as a user dep on every runtime — Node, the Deno source-run,
      // AND the compiled binary — so a handler's own `import { z } from "zod"` is
      // rewritten to a resolvable specifier. Excluding it left a bare `import "zod"`
      // in the temp handler that Deno cannot resolve → "not a dependency and not in
      // import map" → 500. (The Node path already always-resolves zod via
      // getNodeExternalPackagesToResolve.) On the compiled binary, keeping zod in
      // userDeps routes it through rewriteCompiledBinaryUserDependencyImports like
      // any other npm package, so its import resolves from the project's
      // node_modules via the createRequire shim. zod is still force-externalized
      // below, never bundled inline. See veryfront-issue-inbox#217.
      const userDeps = getUserDependencies(allDeps);

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

      const { build } = await import("veryfront/extensions/bundler");

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
          createImportMapPlugin(projectDir, sourceSnapshot, config),
          createProjectAliasPlugin(sourceSnapshot, projectDir),
          createAdapterResolvePlugin(sourceSnapshot, projectDir),
          createHTTPPlugin({ allowedHosts, projectDir }),
          createProjectBoundaryPlugin(sourceSnapshot),
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

      logger.debug(`built handler ${resolvedPath}`);
      const js = result.outputFiles?.[0]?.text ?? "export {}";
      logger.debug(`transpiled size ${js.length} bytes`);

      return await rewriteExternalImports(js, projectDir, sourceSnapshot, userDeps);
    },
    { "api.modulePath": modulePath, "api.projectDir": projectDir },
  );
}

async function readFileWithExtensions(
  sourceSnapshot: ProjectSourceSnapshot,
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
      const contents = await sourceSnapshot.readTextFile(filePath);
      return { filePath, contents };
    } catch (error) {
      if (error instanceof ProjectBoundaryViolationError) throw error;
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

export function getUserDependencies(
  allDeps: ReadonlyMap<string, string>,
): Map<string, string> {
  const frameworkPackages = new Set(["veryfront", "react", "react-dom", "path"]);

  const frameworkPrefixes = ["@opentelemetry/", "node:", "veryfront/"];
  const userDeps = new Map<string, string>();
  for (const [name, version] of allDeps) {
    if (frameworkPackages.has(name)) continue;
    if (frameworkPrefixes.some((prefix) => name.startsWith(prefix))) continue;
    userDeps.set(name, version);
  }
  return userDeps;
}

async function loadModuleFromCode(
  code: string,
  fs: FileSystem,
): Promise<APIRoute> {
  const tempDir = await fs.makeTempDir({ prefix: "vf-api-" });
  const tempFile = pathHelper.join(tempDir, "handler.mjs");

  const transformedCode = code;

  // In compiled Deno binaries, external modules loaded from temp files cannot
  // resolve "veryfront" since the source is embedded in the binary's virtual FS.
  // Write runtime shims: a root shim for `from "veryfront"` and per-subpath shims
  // for `from "veryfront/xxx"` (e.g., middleware, workflow, tool).
  if (isDeno && isCompiledBinary()) {
    // Register the real public root module, then generate its shim from the
    // namespace exports. This keeps compiled-binary routes aligned with the
    // source barrel as exports are added or removed.
    await registerVfModules(new Set([""]));
    await fs.writeTextFile(
      pathHelper.join(tempDir, "_vf_runtime.mjs"),
      generateSubpathShim(""),
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
    const moduleKey = subpath || "veryfront";
    if (modules[moduleKey]) continue;

    const specifier = subpath ? `veryfront/${subpath}` : "veryfront";

    const fromDiscovery = discoveryModules?.[specifier];
    if (fromDiscovery) {
      modules[moduleKey] = fromDiscovery;
      logger.debug(`[API] Registered module ${specifier} from discovery globals`);
      continue;
    }

    try {
      modules[moduleKey] = await import(specifier) as Record<string, unknown>;
      logger.debug(`[API] Registered module ${specifier} on globalThis`);
    } catch (e) {
      logger.warn(`[API] Failed to register ${specifier}: ${e}`);
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
  const moduleKey = subpath || "veryfront";
  const specifier = subpath ? `veryfront/${subpath}` : "veryfront";
  const mod = modules?.[moduleKey];

  if (!mod) {
    return `throw new Error("${specifier} runtime not registered in compiled binary context");`;
  }

  const exportNames = Object.keys(mod).filter((k) => k !== "default" && k !== "__esModule");
  const lines: string[] = [
    `// Auto-generated shim for ${specifier}`,
    `const _mod = globalThis.__vfModules["${moduleKey}"];`,
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
