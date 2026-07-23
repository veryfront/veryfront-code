import { serverLogger } from "#veryfront/utils";
import type { BuildResult, Plugin } from "veryfront/extensions/bundler";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createHTTPPlugin } from "./esbuild-plugin.ts";
import { validateHTTPImports } from "./http-validator.ts";
import { loadSecurityConfig } from "./security-config.ts";
import type { APIRoute, LoadModuleOptions } from "./types.ts";
import { createError, SECURITY_VIOLATION, toError, VeryfrontError } from "#veryfront/errors";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { FILE_EXTENSIONS, getLoaderForFile, validateModulePath } from "./loader-helpers.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";
import { isCompiledBinary } from "#veryfront/utils";
import { wrapWithCurrentContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import {
  getCanonicalBaseDir,
  getCanonicalPath,
} from "#veryfront/security/path-validation/canonical.ts";
import {
  findModuleSpecifierSpans,
  tokenizeJavaScriptSource,
} from "#veryfront/modules/loader-shared/import-specifiers.ts";
import {
  decodeVeryfrontSubpath,
  encodeVeryfrontSubpath,
  generateCompiledBinaryRequireShim,
  NODE_BUILTINS,
  readProjectDependencies,
  rewriteExternalImports,
} from "./external-import-rewriter.ts";
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
const MAX_HANDLER_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_DIRECT_IMPORT_FILES = 1_000;
const MAX_DIRECT_IMPORT_DEPTH = 64;

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
        if (error instanceof VeryfrontError) throw error;
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Failed to load API handler", {
          errorCategory: classifyTelemetryError(error),
          module: pathHelper.relative(projectDir, modulePath),
        });
        throw toError(
          createError({
            type: "api",
            message: `Failed to load API handler: ${errorMsg}`,
          }),
        );
      }
    },
    { "api.module": pathHelper.basename(options.modulePath) },
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

  // Always transpile TypeScript in compiled binaries - they can't import raw .ts files
  if (!isDeno || isCompiledBinary()) {
    return loadAndTranspileModule(modulePath, projectDir, adapter, fs, config);
  }

  const fileExistsLocally = await fs.exists(modulePath);
  if (fileExistsLocally) {
    await assertCanonicalPathWithinProject(modulePath, projectDir, adapter);
    const allowedHosts = await loadSecurityConfig(projectDir, adapter);
    const inspection = await inspectDirectImportGraph(
      modulePath,
      projectDir,
      adapter,
      allowedHosts,
      config,
    );
    if (!inspection.requiresBundling) return loadModuleDirect(modulePath);
  }

  logger.debug("Using adapter-based API module loading", {
    module: pathHelper.relative(projectDir, modulePath),
  });
  return loadAndTranspileModule(modulePath, projectDir, adapter, fs, config);
}

/**
 * Directly import a TypeScript module in Deno without bundling.
 * This allows the module to share the same runtime context as the dev server,
 * enabling auto-discovery features like agentRegistry to work.
 */
function loadModuleDirect(modulePath: string): Promise<APIRoute> {
  const url = pathHelper.toFileUrl(modulePath);
  url.searchParams.set("vf_reload", crypto.randomUUID());
  logger.debug("Direct API module import", { module: pathHelper.basename(modulePath) });
  return import(url.href);
}

interface DirectImportInspection {
  requiresBundling: boolean;
}

function resolveImportMapEntry(
  imports: Record<string, string> | undefined,
  specifier: string,
): string | undefined {
  if (!imports) return undefined;
  if (Object.hasOwn(imports, specifier)) return imports[specifier];

  const prefix = Object.keys(imports)
    .filter((key) => key.endsWith("/") && specifier.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  if (!prefix) return undefined;

  const target = imports[prefix];
  if (typeof target !== "string") return undefined;
  if (!target.endsWith("/")) {
    throw toError(
      createError({
        type: "api",
        message: `Import map prefix target must end with "/": ${prefix}`,
      }),
    );
  }
  return target + specifier.slice(prefix.length);
}

function resolveImportMapSpecifier(
  config: VeryfrontConfig | undefined,
  projectDir: string,
  importer: string,
  specifier: string,
): string | undefined {
  const importMap = config?.resolve?.importMap;
  if (!importMap) return undefined;

  const baseUrl = pathHelper.toFileUrl(`${pathHelper.resolve(projectDir)}/`);
  const importerUrl = /^https?:\/\//i.test(importer)
    ? importer
    : pathHelper.toFileUrl(pathHelper.resolve(importer)).href;
  const matchingScopes = Object.entries(importMap.scopes ?? {})
    .map(([scope, imports]) => {
      try {
        return { scopeUrl: new URL(scope, baseUrl).href, imports };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { scopeUrl: string; imports: Record<string, string> } =>
      entry !== null && importerUrl.startsWith(entry.scopeUrl)
    )
    .sort((a, b) => b.scopeUrl.length - a.scopeUrl.length);

  for (const scope of matchingScopes) {
    const resolved = resolveImportMapEntry(scope.imports, specifier);
    if (resolved !== undefined) return resolved;
  }
  return resolveImportMapEntry(importMap.imports, specifier);
}

async function assertCanonicalPathWithinProject(
  candidate: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<void> {
  const resolvedProject = pathHelper.resolve(projectDir);
  const resolvedCandidate = pathHelper.resolve(candidate);
  if (!isWithinDirectory(resolvedProject, resolvedCandidate)) {
    throw SECURITY_VIOLATION.create({
      message: "[API] module path escapes project directory",
    });
  }

  const [{ path: canonicalCandidate }, canonicalProject] = await Promise.all([
    getCanonicalPath(resolvedCandidate, adapter, true),
    getCanonicalBaseDir(resolvedProject, adapter),
  ]);
  if (
    !isWithinDirectory(pathHelper.resolve(canonicalProject), pathHelper.resolve(canonicalCandidate))
  ) {
    throw SECURITY_VIOLATION.create({
      message: "[API] module path escapes project directory through a symbolic link",
    });
  }
}

function validateHandlerSourceSize(source: string): void {
  if (new TextEncoder().encode(source).byteLength <= MAX_HANDLER_SOURCE_BYTES) return;
  throw toError(
    createError({
      type: "api",
      message: `API route modules must not exceed ${MAX_HANDLER_SOURCE_BYTES} bytes`,
    }),
  );
}

function hasNonLiteralDynamicImport(source: string): boolean {
  const tokens = tokenizeJavaScriptSource(source);
  for (let index = 0; index < tokens.length - 2; index++) {
    if (tokens[index]?.value !== "import" || tokens[index + 1]?.value !== "(") continue;
    if (tokens[index + 2]?.type !== "string") return true;
  }
  return false;
}

async function inspectDirectImportGraph(
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  allowedHosts: string[],
  config?: VeryfrontConfig,
): Promise<DirectImportInspection> {
  const visited = new Set<string>();
  let requiresBundling = false;

  async function visit(basePath: string, depth: number, required: boolean): Promise<void> {
    if (depth > MAX_DIRECT_IMPORT_DEPTH) {
      throw toError(
        createError({
          type: "api",
          message: `API route imports support at most ${MAX_DIRECT_IMPORT_DEPTH} local levels`,
        }),
      );
    }

    const loaded = await tryReadFileWithExtensions(
      adapter,
      basePath,
      FILE_EXTENSIONS,
      projectDir,
    );
    if (!loaded) {
      if (!required) return;
      throw toError(createError({ type: "file", message: `File not found: ${basePath}` }));
    }
    if (visited.has(loaded.filePath)) return;
    visited.add(loaded.filePath);
    if (visited.size > MAX_DIRECT_IMPORT_FILES) {
      throw toError(
        createError({
          type: "api",
          message: `API route imports support at most ${MAX_DIRECT_IMPORT_FILES} local modules`,
        }),
      );
    }

    validateHandlerSourceSize(loaded.contents);
    validateHTTPImports(loaded.contents, allowedHosts);
    if (hasNonLiteralDynamicImport(loaded.contents)) {
      throw SECURITY_VIOLATION.create({
        message: "API route dynamic imports must use a string literal",
      });
    }

    for (const { specifier } of findModuleSpecifierSpans(loaded.contents)) {
      if (/^https?:\/\//i.test(specifier)) {
        requiresBundling = true;
        continue;
      }
      if (resolveImportMapSpecifier(config, projectDir, loaded.filePath, specifier) !== undefined) {
        requiresBundling = true;
        continue;
      }

      let dependencyPath: string | undefined;
      if (specifier.startsWith("file:")) {
        try {
          dependencyPath = pathHelper.fromFileUrl(specifier);
        } catch {
          throw SECURITY_VIOLATION.create({ message: "Invalid file URL in API route import" });
        }
      } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const pathWithoutQuery = specifier.split(/[?#]/, 1)[0] ?? specifier;
        dependencyPath = pathHelper.resolve(pathHelper.dirname(loaded.filePath), pathWithoutQuery);
      } else if (pathHelper.isAbsolute(specifier)) {
        dependencyPath = specifier;
      }

      if (!dependencyPath) continue;
      await assertCanonicalPathWithinProject(dependencyPath, projectDir, adapter);
      await visit(dependencyPath, depth + 1, false);
    }
  }

  await visit(modulePath, 0, true);
  return { requiresBundling };
}

function createImportMapPlugin(
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
): Plugin {
  const importMap = config?.resolve?.importMap;
  const importMapEntries = Object.keys(importMap?.imports ?? {}).length +
    Object.values(importMap?.scopes ?? {}).reduce(
      (count, entries) => count + Object.keys(entries).length,
      0,
    );

  if (importMapEntries === 0) return { name: "import-map", setup() {} };

  logger.info("Using API import map", { entries: importMapEntries });

  return {
    name: "import-map",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.path.startsWith("http://") || args.path.startsWith("https://")) return undefined;
        if (args.path.startsWith("node:")) return { path: args.path, external: true };

        if (args.namespace === "import-map" && args.path.startsWith(".")) {
          const importerDir = pathHelper.dirname(args.importer);
          const absolutePath = pathHelper.resolve(importerDir, args.path);
          await assertCanonicalPathWithinProject(absolutePath, projectDir, adapter);

          return { path: absolutePath, namespace: "import-map" };
        }

        if (pathHelper.isAbsolute(args.path) && args.namespace !== "import-map") return undefined;

        const importer = args.importer || pathHelper.join(projectDir, "__entry__.ts");
        let resolvedPath = resolveImportMapSpecifier(config, projectDir, importer, args.path);

        if (!resolvedPath) return undefined;

        if (resolvedPath.startsWith("http://") || resolvedPath.startsWith("https://")) {
          return { path: resolvedPath, namespace: "http-url" };
        }

        if (resolvedPath.startsWith("file:")) resolvedPath = pathHelper.fromFileUrl(resolvedPath);

        const absolutePath = pathHelper.isAbsolute(resolvedPath)
          ? resolvedPath
          : pathHelper.resolve(projectDir, resolvedPath);

        if (!isWithinDirectory(pathHelper.resolve(projectDir), absolutePath)) {
          return { errors: [{ text: `Import map path escapes project: ${args.path}` }] };
        }
        await assertCanonicalPathWithinProject(absolutePath, projectDir, adapter);

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
      logger.error(`Failed to load ${errorLabel}`, {
        errorCategory: classifyTelemetryError(error),
        module: pathHelper.basename(args.path),
      });
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
          logger.error("[API] Adapter resolve path escapes project", {
            import: pathHelper.basename(args.path),
          });
          return {
            errors: [{ text: `Relative import escapes project: ${args.path}` }],
          };
        }

        logger.debug("[API] Adapter import resolved", {
          import: pathHelper.basename(args.path),
          importer: args.importer ? pathHelper.basename(args.importer) : "stdin",
        });
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
  return buildHandlerModule(
    modulePath,
    projectDir,
    adapter,
    fs,
    config,
    (code, userDeps) => loadModuleFromCode(code, projectDir, fs, userDeps),
  );
}

/**
 * Bundle a route module without importing it in the current process. The
 * resulting code is intended only for evaluation inside an isolation worker.
 */
export function bundleHandlerModuleForIsolation(options: LoadModuleOptions): Promise<string> {
  return withSpan(
    "api.bundleHandlerModuleForIsolation",
    async () => {
      const { projectDir, modulePath, adapter, config } = options;
      const fs = createFileSystem();
      validateModulePath(modulePath, projectDir);

      try {
        return await buildHandlerModule(
          modulePath,
          projectDir,
          adapter,
          fs,
          config,
          (code, userDeps) =>
            rewriteExternalImports(code, projectDir, fs, userDeps, {
              // A data/blob module executes inside the framework Worker, where
              // public Veryfront imports resolve through the Worker's import map.
              preserveVeryfrontImports: true,
            }),
        );
      } catch (error) {
        if (error instanceof VeryfrontError) throw error;
        throw toError(
          createError({
            type: "api",
            message: "Failed to prepare API handler for isolated execution",
          }),
        );
      }
    },
    { "api.module": pathHelper.basename(options.modulePath) },
  );
}

function buildHandlerModule<T>(
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  fs: FileSystem,
  config: VeryfrontConfig | undefined,
  consume: (code: string, userDeps: Map<string, string>) => Promise<T>,
): Promise<T> {
  return withSpan(
    "api.buildHandlerModule",
    async () => {
      const { filePath: resolvedPath, contents: source } = await readFileWithExtensions(
        adapter,
        modulePath,
        FILE_EXTENSIONS,
        projectDir,
      );
      validateHandlerSourceSize(source);

      const loader = getEsbuildLoader(resolvedPath);

      const allowedHosts = await loadSecurityConfig(projectDir, adapter);
      validateHTTPImports(source, allowedHosts);

      // Project metadata can live exclusively behind a remote adapter. Read
      // package.json through that adapter while retaining the host filesystem
      // for dependency resolution and temporary module work.
      const dependencyMetadataFs: FileSystem = {
        ...fs,
        readTextFile: (path) => adapter.fs.readFile(path),
      };
      const allDeps = await readProjectDependencies(projectDir, dependencyMetadataFs);

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
        logLevel: "silent",
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
          createHTTPPlugin({ allowedHosts, projectDir }),
        ],
      });

      if (result.errors?.length) {
        const first = result.errors[0]?.text || "unknown error";
        if (first.includes("Remote import blocked by allow-list")) {
          throw SECURITY_VIOLATION.create({ message: first });
        }
        throw toError(
          createError({
            type: "api",
            message: `[API] handler build failed: ${first}`,
          }),
        );
      }

      logger.info("Built API route handler", { module: pathHelper.basename(resolvedPath) });
      const js = result.outputFiles?.[0]?.text ?? "export {}";
      logger.debug(`transpiled size ${js.length} bytes`);

      return await consume(js, userDeps);
    },
    { "api.module": pathHelper.basename(modulePath) },
  );
}

async function tryReadFileWithExtensions(
  adapter: RuntimeAdapter,
  basePath: string,
  extensions: string[],
  projectDir?: string,
): Promise<{ filePath: string; contents: string } | null> {
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
      await assertCanonicalPathWithinProject(resolved, resolvedProjectDir, adapter);
    }

    try {
      const contents = await adapter.fs.readFile(filePath);
      return { filePath, contents };
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      /* expected: try the next extension candidate */
    }
  }

  return null;
}

async function readFileWithExtensions(
  adapter: RuntimeAdapter,
  basePath: string,
  extensions: string[],
  projectDir?: string,
): Promise<{ filePath: string; contents: string }> {
  const loaded = await tryReadFileWithExtensions(adapter, basePath, extensions, projectDir);
  if (loaded) return loaded;

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
  let loadedModule: APIRoute | undefined;
  let loadFailed = false;
  let loadError: unknown;

  try {
    const transformedCode = await rewriteExternalImports(code, projectDir, fs, userDeps);

    // In compiled Deno binaries, external modules loaded from temp files cannot
    // resolve "veryfront" since the source is embedded in the binary's virtual FS.
    if (isDeno && isCompiledBinary()) {
      await import("#veryfront/agent/factory.ts");
      await fs.writeTextFile(
        pathHelper.join(tempDir, "_vf_runtime.mjs"),
        VERYFRONT_RUNTIME_SHIM,
      );

      const subpaths = extractSubpathsFromCode(transformedCode);
      if (subpaths.size > 0) {
        await registerVfModules(subpaths);

        for (const subpath of subpaths) {
          const shimName = `_vf_${encodeVeryfrontSubpath(subpath)}.mjs`;
          const shimCode = generateSubpathShim(subpath);
          await fs.writeTextFile(pathHelper.join(tempDir, shimName), shimCode);
        }
      }
    }

    await fs.writeTextFile(tempFile, transformedCode);

    const moduleUrl = pathHelper.toFileUrl(tempFile);
    moduleUrl.searchParams.set("vf_reload", crypto.randomUUID());
    loadedModule = await import(moduleUrl.href);
  } catch (error: unknown) {
    loadFailed = true;
    loadError = error;
    logger.error("Dynamic API module import failed", {
      errorCategory: classifyTelemetryError(error),
    });
  }

  let cleanupFailed = false;
  let cleanupError: unknown;
  try {
    await fs.remove(tempDir, { recursive: true });
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
    logger.error("Failed to remove temporary API module directory", {
      errorCategory: classifyTelemetryError(error),
    });
  }

  if (loadFailed && cleanupFailed) {
    throw new AggregateError(
      [loadError, cleanupError],
      "API module loading and temporary directory cleanup failed",
    );
  }
  if (loadFailed) throw loadError;
  if (cleanupFailed) throw cleanupError;
  if (!loadedModule) throw new TypeError("API module import returned no module namespace");
  return loadedModule;
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
 * After rewriteExternalImports, subpath imports use hex-encoded shim names.
 */
function extractSubpathsFromCode(code: string): Set<string> {
  const subpaths = new Set<string>();

  const re = /_vf_([0-9a-f]+)\.mjs/g;
  let match;
  while ((match = re.exec(code)) !== null) {
    const encoded = match[1];
    if (encoded) subpaths.add(decodeVeryfrontSubpath(encoded));
  }

  return subpaths;
}

/**
 * Register veryfront modules on globalThis so per-subpath shims can delegate.
 * Imports are from embedded source (works in compiled binaries).
 */
async function registerVfModules(subpaths: Set<string>): Promise<void> {
  const existingModules = (globalThis as Record<string, unknown>).__vfModules;
  const modules = existingModules && typeof existingModules === "object"
    ? existingModules as Record<string, Record<string, unknown>>
    : Object.create(null) as Record<string, Record<string, unknown>>;

  // __VERYFRONT_MODULES__ is populated by the discovery transpiler via hash
  // imports (#veryfront/...) which resolve correctly in compiled binaries.
  // Check it first before attempting bare specifier dynamic imports.
  const discoveryModules = (globalThis as Record<string, unknown>).__VERYFRONT_MODULES__ as
    | Record<string, Record<string, unknown>>
    | undefined;

  for (const subpath of subpaths) {
    if (Object.hasOwn(modules, subpath)) continue;

    const specifier = `veryfront/${subpath}`;

    const fromDiscovery = discoveryModules && Object.hasOwn(discoveryModules, specifier)
      ? discoveryModules[specifier]
      : undefined;
    if (fromDiscovery) {
      modules[subpath] = fromDiscovery;
      logger.debug(`[API] Registered module ${specifier} from discovery globals`);
      continue;
    }

    modules[subpath] = await import(specifier) as Record<string, unknown>;
    logger.debug(`[API] Registered module ${specifier} on globalThis`);
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
    `const _mod = globalThis.__vfModules[${JSON.stringify(subpath)}];`,
  ];

  for (const [index, name] of exportNames.entries()) {
    const binding = `_vf_export_${index}`;
    lines.push(`const ${binding} = _mod[${JSON.stringify(name)}];`);
    lines.push(`export { ${binding} as ${JSON.stringify(name)} };`);
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
