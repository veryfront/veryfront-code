import { computeCodeHash, computeHash, isCompiledBinary, serverLogger } from "#veryfront/utils";
import type {
  BuildResult,
  BundleOptions,
  Bundler,
  Plugin,
  TypeScriptDecoratorOptions,
} from "veryfront/extensions/bundler";
import { readTypeScriptDecoratorOptions } from "veryfront/extensions/bundler";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createHTTPPlugin } from "./esbuild-plugin.ts";
import { rewriteImportMetaLocations } from "./source-capability-analyzer.ts";
import {
  type LocalWorkerSpecifier,
  restrictedRuntimeModuleReason,
  type ValidatedModuleScan,
  validateHTTPImports,
  validateModuleSpecifierHosts,
} from "./http-validator.ts";
import { loadSecurityConfig } from "./security-config.ts";
import type { APIRoute, LoadHostModuleOptions, LoadModuleOptions } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import { tryResolve as tryResolveExtensionContract } from "#veryfront/extensions/contracts.ts";
import { parseExtensionManifest } from "#veryfront/extensions/manifest-reader.ts";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import { captureBoundedTextReader } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import * as pathHelper from "#veryfront/compat/path";
import { FILE_EXTENSIONS, getLoaderForFile, validateModulePath } from "./loader-helpers.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
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
import { tryGetRegistryScopeId } from "#veryfront/cache/cache-key-builder.ts";
import { getProjectEnvSnapshot } from "#veryfront/server/project-env/storage.ts";
import { currentRequestContext } from "#veryfront/platform/request-context-access.ts";
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
const IntrinsicMap = Map;
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicReflectOwnKeys = Reflect.ownKeys;
const MapPrototypeDelete = Map.prototype.delete;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeSet = Map.prototype.set;
const trustedRequestContextAccessor = currentRequestContext;

/**
 * A specifier the HTTP plugin fetches rather than a path. URL schemes are
 * case-insensitive, so every reading of an import-map target has to agree on
 * that or a target such as `HTTPS://example.com/mod.js` is kept as remote in
 * one place and resolved as a project path in another.
 */
const REMOTE_URL_SPECIFIER = /^https?:\/\//i;
const INLINE_MODULE_URL_SPECIFIER = /^(?:data|blob):/i;
const MAX_TYPESCRIPT_CONFIG_BYTES = 1024 * 1024;
const ROUTE_RUNTIME_SHIM_SPECIFIER = "veryfront:route-runtime-shim";
const ROUTE_RUNTIME_SHIM_NAMESPACE = "veryfront-route-runtime-shim";

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
        const module = await loadModule({
          modulePath,
          projectDir,
          adapter,
          fs,
          config,
          allowHostTypeScriptConfigReads: true,
        });
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
        return Object.freeze({
          source,
          sha256: await computeHash(source),
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
  allowHostTypeScriptConfigReads: boolean;
}): Promise<APIRoute> {
  const {
    modulePath,
    projectDir,
    adapter,
    fs,
    config,
    allowHostTypeScriptConfigReads,
  } = args;

  if (modulePath.endsWith(".js")) {
    const bundler = selectedTypeScriptBundler();
    if (!bundler) {
      return loadValidatedJSModule(
        modulePath,
        projectDir,
        adapter,
        fs,
        config,
        undefined,
        allowHostTypeScriptConfigReads,
      );
    }
    const decoratorOptions = await readProjectTypeScriptDecoratorOptions(
      projectDir,
      await createProjectSourceSnapshot(projectDir, adapter),
      allowHostTypeScriptConfigReads,
    );
    if (!bundlerForcesTypeScript(bundler, decoratorOptions)) {
      return loadValidatedJSModule(
        modulePath,
        projectDir,
        adapter,
        fs,
        config,
        decoratorOptions,
        allowHostTypeScriptConfigReads,
      );
    }
    return loadAndTranspileModule(
      modulePath,
      projectDir,
      adapter,
      fs,
      config,
      decoratorOptions,
      allowHostTypeScriptConfigReads,
    );
  }

  // Always transpile TypeScript in compiled binaries - they can't import raw .ts files
  if (!isDeno || isCompiledBinary()) {
    return loadAndTranspileModule(
      modulePath,
      projectDir,
      adapter,
      fs,
      config,
      undefined,
      allowHostTypeScriptConfigReads,
    );
  }

  const fileExistsLocally = await fs.exists(modulePath);
  if (fileExistsLocally) {
    const bundler = selectedTypeScriptBundler();
    const decoratorOptions = bundler
      ? await readProjectTypeScriptDecoratorOptions(
        projectDir,
        await createProjectSourceSnapshot(projectDir, adapter),
        allowHostTypeScriptConfigReads,
      )
      : undefined;
    if (decoratorOptions && bundlerForcesTypeScript(bundler, decoratorOptions)) {
      return loadAndTranspileModule(
        modulePath,
        projectDir,
        adapter,
        fs,
        config,
        decoratorOptions,
        allowHostTypeScriptConfigReads,
      );
    }

    // Deno's direct module loader bypasses the HTTP bundler plugin and
    // resolves the whole import graph itself, not just this file. Vet the
    // statically walkable local graph before importing; a graph the walk
    // cannot fully constrain must bundle instead, where the HTTP plugin
    // enforces every remote fetch.
    const allowedHosts = await loadSecurityConfig(projectDir, adapter, config);
    if (!await canDirectImportModuleGraph({ modulePath, projectDir, fs, allowedHosts })) {
      return loadAndTranspileModule(
        modulePath,
        projectDir,
        adapter,
        fs,
        config,
        decoratorOptions,
        allowHostTypeScriptConfigReads,
      );
    }

    try {
      return await loadTSModuleDirect(modulePath, await moduleRevision(fs, modulePath));
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
      return loadAndTranspileModule(
        modulePath,
        projectDir,
        adapter,
        fs,
        config,
        decoratorOptions,
        allowHostTypeScriptConfigReads,
      );
    }
  }

  logger.debug(`File not local, using adapter-based loading: ${modulePath}`);
  return loadAndTranspileModule(
    modulePath,
    projectDir,
    adapter,
    fs,
    config,
    undefined,
    allowHostTypeScriptConfigReads,
  );
}

/** @internal Exported for the runtime-selection regression test. */
export function bundlerForcesTypeScript(
  bundler: Pick<Bundler, "shouldBundleTypeScript"> | undefined,
  options: TypeScriptDecoratorOptions,
): boolean {
  return bundler?.shouldBundleTypeScript?.(options) === true;
}

/** @internal Exported for the runtime-selection regression test. */
export function typeScriptBuildOptions(
  projectDir: string,
  options: TypeScriptDecoratorOptions,
  bundleTypeScript: boolean,
): Pick<BundleOptions, "typescriptDecoratorOptions"> & { absWorkingDir?: string } {
  return {
    typescriptDecoratorOptions: options,
    ...(bundleTypeScript ? { absWorkingDir: projectDir } : {}),
  };
}

function selectedTypeScriptBundler():
  | Pick<Bundler, "shouldBundleTypeScript">
  | undefined {
  const bundler = tryResolveExtensionContract<Bundler>("Bundler");
  return bundler?.shouldBundleTypeScript ? bundler : undefined;
}

async function readProjectTypeScriptDecoratorOptions(
  projectDir: string,
  sourceSnapshot: ProjectSourceSnapshot,
  allowHostConfigReads: boolean,
): Promise<TypeScriptDecoratorOptions> {
  const projectRoot = pathHelper.resolve(projectDir);
  return await readTypeScriptDecoratorOptions({
    configPath: pathHelper.join(projectRoot, "tsconfig.json"),
    readTextFile: async (path) => {
      const resolvedPath = pathHelper.resolve(path);
      if (isWithinDirectory(projectRoot, resolvedPath)) {
        return await sourceSnapshot.readTextFileWithinLimit(
          resolvedPath,
          MAX_TYPESCRIPT_CONFIG_BYTES,
          "TypeScript configuration",
        );
      }
      if (!allowHostConfigReads) {
        throw new TypeError(
          "TypeScript configuration inheritance outside the project directory requires trusted host execution",
        );
      }
      return await readTrustedHostTypeScriptConfig(resolvedPath);
    },
    ...(allowHostConfigReads ? {} : {
      resolveExtends: (specifier: string, fromPath: string) =>
        resolveIsolatedTypeScriptExtends(specifier, fromPath, projectRoot),
    }),
  });
}

function withTypeScriptConfigExtension(path: string): string {
  const extension = pathHelper.extname(path).toLowerCase();
  return extension === ".json" || extension === ".jsonc" ? path : `${path}.json`;
}

function rejectExternalTypeScriptConfig(): never {
  throw new TypeError(
    "TypeScript configuration inheritance outside the project directory requires trusted host execution",
  );
}

function resolveIsolatedTypeScriptExtends(
  specifier: string,
  fromPath: string,
  projectRoot: string,
): Promise<string> {
  let candidate: string;
  if (pathHelper.isAbsolute(specifier) || specifier.startsWith(".")) {
    candidate = withTypeScriptConfigExtension(
      pathHelper.resolve(pathHelper.dirname(fromPath), specifier),
    );
  } else {
    if (specifier.includes("\\") || specifier.includes(":")) {
      rejectExternalTypeScriptConfig();
    }
    const parts = specifier.split("/");
    const packagePartCount = specifier.startsWith("@") ? 2 : 1;
    if (
      parts.length < packagePartCount ||
      parts.some((part) => part.length === 0 || part === "." || part === "..")
    ) {
      rejectExternalTypeScriptConfig();
    }
    const packageRoot = pathHelper.join(
      projectRoot,
      "node_modules",
      ...parts.slice(0, packagePartCount),
    );
    const subpath = parts.slice(packagePartCount);
    candidate = subpath.length === 0
      ? pathHelper.join(packageRoot, "tsconfig.json")
      : withTypeScriptConfigExtension(pathHelper.join(packageRoot, ...subpath));
  }

  if (!isWithinDirectory(projectRoot, candidate)) {
    rejectExternalTypeScriptConfig();
  }
  return Promise.resolve(candidate);
}

async function readTrustedHostTypeScriptConfig(path: string): Promise<string> {
  const hostFileSystem = createFileSystem();
  if (!hostFileSystem.lstat) {
    throw new TypeError("Trusted TypeScript configuration requires lstat support");
  }
  const info = await hostFileSystem.lstat(path);
  if (!info.isFile || info.isSymlink) {
    throw new TypeError("Trusted TypeScript configuration must be a regular file");
  }
  const reader = captureBoundedTextReader(
    hostFileSystem,
    "Trusted TypeScript configuration reader",
  );
  return (await reader.readUtf8(
    path,
    MAX_TYPESCRIPT_CONFIG_BYTES,
    "TypeScript configuration",
  )).content;
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

/**
 * Cache key for a route module's current contents.
 *
 * Every request loads its route through here, so keying on the clock would mint
 * a new module per request: module-level state (clients, caches, pools) would
 * reset between requests in dev while persisting in production, with no error
 * to show for it. Keying on mtime keeps an edit hot-reloading while letting an
 * untouched route keep the module it already has.
 *
 * The content digest is the durable signal. Mtime is included only to keep the
 * key readable while guarding filesystems whose observable timestamp can
 * collide for two same-size edits.
 *
 * A filesystem that cannot report stat or content falls back to the clock,
 * which is no worse than reloading every time.
 */
async function moduleRevision(fs: FileSystem, modulePath: string): Promise<string> {
  try {
    const { mtime } = await fs.stat(modulePath);
    const source = await fs.readTextFile(modulePath);
    const digest = await computeHash(source);
    return `${mtime?.getTime() ?? "unknown"}-${digest}`;
  } catch {
    // An unreadable path still has to load; fall through to the clock.
  }
  return String(Date.now());
}

function loadTSModuleDirect(modulePath: string, revision: string): Promise<APIRoute> {
  const cacheBuster = `?v=${revision}`;
  const url = modulePath.startsWith("file://")
    ? `${modulePath}${cacheBuster}`
    : `file://${modulePath}${cacheBuster}`;

  logger.debug(`Direct import (Deno): ${url}`);
  return import(url);
}

function loadJSModule(modulePath: string): Promise<APIRoute> {
  return import(`file://${modulePath}`);
}

/**
 * A direct import hands the whole module graph to the runtime's own loader, so
 * the entry file's allow-list check alone would leave local helpers and remote
 * transitive imports unvalidated. Walk the statically visible local graph,
 * validating every file's remote specifiers against the allow-list.
 *
 * Returns false when the graph contains anything the walk cannot soundly
 * constrain — a remote import (even an allowed one, since only the bundler's
 * HTTP plugin enforces what that module imports in turn), a specifier that
 * resolves outside the project, or a file that cannot be read. Those loads
 * must bundle instead. Throws when a walked file names a disallowed host.
 */
async function canDirectImportModuleGraph(args: {
  modulePath: string;
  projectDir: string;
  fs: FileSystem;
  allowedHosts: string[];
}): Promise<boolean> {
  const { projectDir, fs, allowedHosts } = args;
  const projectRoot = pathHelper.resolve(projectDir);
  const routeModulePath = pathHelper.resolve(args.modulePath);
  const pending = [routeModulePath];
  const visited = new Set<string>();
  const importMap = await readDenoImportMap(fs, projectRoot);
  let canDirectImport = true;

  while (pending.length > 0) {
    const filePath = pending.pop() as string;
    if (markDirectGraphVisit(visited, filePath)) {
      const moduleResult = await inspectDirectGraphModule({
        filePath,
        routeModulePath,
        projectRoot,
        fs,
        allowedHosts,
        importMap,
        pending,
      });
      if (moduleResult === "reject") return false;
      if (moduleResult === "bundle") canDirectImport = false;
    }
  }

  return canDirectImport;
}

function markDirectGraphVisit(visited: Set<string>, filePath: string): boolean {
  if (visited.has(filePath)) return false;
  visited.add(filePath);
  return true;
}

async function inspectDirectGraphModule(options: {
  filePath: string;
  routeModulePath: string;
  projectRoot: string;
  fs: FileSystem;
  allowedHosts: string[];
  importMap: DenoImportMap | null;
  pending: string[];
}): Promise<DirectSpecifierResult> {
  const { filePath, routeModulePath, projectRoot, fs, allowedHosts, importMap, pending } = options;
  if (!isWithinDirectory(projectRoot, filePath)) return "reject";
  // JSON is data, so it cannot execute or introduce another module edge.
  if (isJSONModulePath(filePath)) return "direct";

  const source = await readDirectGraphSource(fs, filePath);
  if (source === null) return "reject";

  // Reuse the parser-aware public validator so direct and bundled routes
  // enforce the same remote-import, Worker, and generated-code contract.
  const scan = await validateHTTPImports(source, allowedHosts);
  if (scan.hasUnconstrainedDynamicImport || scan.requiresBundling) return "bundle";

  // A worker's entry is executed by the worker's own loader, which neither
  // this file's import list nor the HTTP plugin ever sees. Vet it as part of
  // the graph; one whose base this scanner does not follow cannot be walked,
  // so the route bundles instead.
  if (
    !enqueueDirectWorkerEntries(
      scan.localWorkerSpecifiers,
      projectRoot,
      filePath,
      routeModulePath,
      pending,
    )
  ) {
    return "reject";
  }
  const specifierResult = inspectDirectModuleSpecifiers({
    specifiers: scan.specifiers,
    importMap,
    filePath,
    projectRoot,
    allowedHosts,
    pending,
  });
  if (specifierResult === "reject") return "reject";
  // A local Worker loads its entry after this graph walk completes. Force the
  // route through the bundled path, which rejects mutable Worker files after
  // validating their graph, instead of handing the original path to Deno.
  return scan.localWorkerSpecifiers.length > 0 ? "bundle" : specifierResult;
}

async function readDirectGraphSource(fs: FileSystem, filePath: string): Promise<string | null> {
  try {
    return await fs.readTextFile(filePath);
  } catch {
    return null;
  }
}

function enqueueDirectWorkerEntries(
  workerSpecifiers: readonly LocalWorkerSpecifier[],
  projectRoot: string,
  filePath: string,
  routeModulePath: string,
  pending: string[],
): boolean {
  for (const worker of workerSpecifiers) {
    const specifier = worker.specifier;
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return false;
    const importer = worker.resolutionBase === "route" ? routeModulePath : filePath;
    pending.push(resolveContainedLocalModule(projectRoot, importer, specifier));
  }
  return true;
}

type DirectSpecifierResult = "direct" | "bundle" | "reject";

interface DirectSpecifierOptions {
  importMap: DenoImportMap | null;
  filePath: string;
  projectRoot: string;
  allowedHosts: string[];
  pending: string[];
}

function inspectDirectModuleSpecifiers(
  options: DirectSpecifierOptions & { specifiers: readonly string[] },
): DirectSpecifierResult {
  let result: DirectSpecifierResult = "direct";
  for (const specifier of options.specifiers) {
    const specifierResult = inspectDirectModuleSpecifier(specifier, options);
    if (specifierResult === "reject") return "reject";
    if (specifierResult === "bundle") result = "bundle";
  }
  return result;
}

function inspectDirectModuleSpecifier(
  specifier: string,
  options: DirectSpecifierOptions,
): DirectSpecifierResult {
  const { importMap, filePath, projectRoot, pending } = options;
  const mappedTarget = importMap === null
    ? null
    : lookupImportMapEntry(importMap, specifier, filePath);
  if (mappedTarget !== null) {
    return inspectDirectMappedTarget(mappedTarget, options);
  }
  // A null map also means the project config may use features this reader
  // cannot flatten, such as `extends`. Route every specifier through the
  // controlled bundler instead of handing an inherited remap to Deno's direct
  // loader after validating a different local path.
  if (importMap === null) return "bundle";
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    pending.push(resolveContainedLocalModule(projectRoot, filePath, specifier));
    return "direct";
  }
  // Package `imports` aliases resolve through the nearest package.json and may
  // target another project-local module that this direct walk has not read.
  if (specifier.startsWith("#")) return "bundle";
  // Explicit installed-dependency schemes are safe to leave to the runtime;
  // every other absolute or custom scheme bundles.
  if (canDirectImportSpecifier(specifier)) return "direct";
  if (!isBareModuleSpecifier(specifier)) return "reject";
  // An unmapped bare specifier can only resolve to an installed package.
  return "direct";
}

function inspectDirectMappedTarget(
  target: string,
  options: DirectSpecifierOptions,
): DirectSpecifierResult {
  const { filePath, projectRoot, allowedHosts, pending } = options;
  // An import map can hide a restricted runtime module behind an ordinary alias.
  const restrictedReason = restrictedRuntimeModuleReason(target);
  if (restrictedReason !== null) {
    throw toError(
      createError({
        type: "api",
        message: `[API] handler build failed: ${restrictedReason}.`,
      }),
    );
  }
  if (pathHelper.isAbsolute(target)) {
    pending.push(resolveContainedLocalModule(projectRoot, filePath, target));
    return "direct";
  }
  if (canDirectImportSpecifier(target)) return "direct";
  validateModuleSpecifierHosts([target], allowedHosts);
  return "bundle";
}

function resolveContainedLocalModule(
  projectRoot: string,
  referrerFile: string,
  specifier: string,
): string {
  let resolved: string;
  try {
    resolved = pathHelper.fromFileUrl(
      new URL(encodedModulePathOfSpecifier(specifier), pathHelper.toFileUrl(referrerFile)),
    );
  } catch {
    throw toError(
      createError({
        type: "api",
        message: `[API] handler build failed: local module URL cannot be resolved: ${specifier}`,
      }),
    );
  }

  if (!isWithinDirectory(projectRoot, resolved)) {
    throw toError(
      createError({
        type: "api",
        message: `[API] handler build failed: local module URL escapes project: ${specifier}`,
      }),
    );
  }
  return resolved;
}

/**
 * The filesystem path a module specifier names, without the `?query` or `#hash`
 * a module URL may carry. Deno loads `./helper.ts?v=1` from `./helper.ts`, so
 * the walk has to look for the file under that name and not the whole URL.
 */
function modulePathOfSpecifier(specifier: string): string {
  return splitModuleSpecifier(specifier).modulePath;
}

/** The module URL path before its single URL-decoding step. */
function encodedModulePathOfSpecifier(specifier: string): string {
  const suffixStart = specifier.search(/[?#]/);
  return suffixStart === -1 ? specifier : specifier.slice(0, suffixStart);
}

function moduleSuffixOfSpecifier(specifier: string): string {
  return splitModuleSpecifier(specifier).suffix;
}

function splitModuleSpecifier(specifier: string): { modulePath: string; suffix: string } {
  const suffixStart = specifier.search(/[?#]/);
  const rawModulePath = suffixStart === -1 ? specifier : specifier.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : specifier.slice(suffixStart);
  if (!rawModulePath.includes("%")) return { modulePath: rawModulePath, suffix };
  try {
    // Decode ordinary filename characters such as `%68`, but keep URL
    // delimiters such as `%3F`, `%23`, and `%2F` encoded until URL resolution.
    return { modulePath: decodeURI(rawModulePath), suffix };
  } catch {
    return { modulePath: rawModulePath, suffix };
  }
}

/** Whether the runtime loads this path as JSON data rather than as a module it executes. */
function isJSONModulePath(filePath: string): boolean {
  return getLoaderForFile(filePath) === "json";
}

/** Whether the runtime resolves this specifier through an import map or an installed package. */
export function isBareModuleSpecifier(specifier: string): boolean {
  if (
    specifier.startsWith("/") || specifier.startsWith("./") || specifier.startsWith("../")
  ) {
    return false;
  }
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier);
}

/** Whether a non-relative specifier is independent of Deno import-map remapping. */
export function canDirectImportSpecifier(specifier: string): boolean {
  if (specifier.startsWith("./") || specifier.startsWith("../")) return true;
  if (specifier.startsWith("/")) return false;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(specifier)?.[1]?.toLowerCase();
  return scheme !== undefined && ["npm", "jsr", "node"].includes(scheme);
}

/** A Deno import map with paths normalized against the file that declared it. */
export interface DenoImportMap {
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
}

/**
 * The reading of a project's files the config parser needs. The host
 * filesystem satisfies it, and so does a project snapshot, whose adapter is the
 * only place an adapter-backed project's config exists.
 */
export interface ModuleTextReader {
  readTextFile(path: string): Promise<string>;
}

const DENO_CONFIG_FILENAMES = ["deno.json", "deno.jsonc"] as const;

/**
 * The import map the runtime applies to a directly imported route, or null
 * when the project has one this loader cannot vet.
 *
 * Deno resolves a route's bare specifiers through the project's own config,
 * which the bundler never reads. A config's `importMap` field is followed to
 * the file it names, and scope prefixes are preserved so both the graph walk
 * and the bundler select mappings using the importing file. Null means
 * "undecidable": a config
 * this parser cannot read in full, whose every bare specifier then bundles. A
 * project with no Deno config has no map: bare specifiers can only reach
 * installed packages.
 */
export async function readDenoImportMap(
  fs: ModuleTextReader,
  projectDir: string,
): Promise<DenoImportMap | null> {
  for (const filename of DENO_CONFIG_FILENAMES) {
    const config = await readJSONObject(fs, pathHelper.join(projectDir, filename));
    if (config === "missing") continue;
    if (config === null) return null;
    // Deno merges inherited import maps before resolving a module. Until this
    // loader models that merge, treating the child alone as complete could
    // approve a direct load that Deno remaps to an unchecked remote module.
    if (config.extends !== undefined) return null;

    // Deno reads a config that declares both an external `importMap` and
    // inline `imports`/`scopes` by its own precedence rules. Modeling only
    // one side could approve a direct load whose specifier the runtime
    // resolves through the other, so such a config stays undecidable.
    if (
      config.importMap !== undefined &&
      (config.imports !== undefined || config.scopes !== undefined)
    ) {
      return null;
    }

    return config.importMap === undefined
      ? readImportMap(config, projectDir)
      : await readSeparateImportMapFile(fs, projectDir, config.importMap);
  }

  return { imports: {}, scopes: {} };
}

/**
 * The parsed object at `filePath`, `"missing"` when there is no such file, and
 * null when it is present but not a plain JSON object this parser can read.
 */
async function readJSONObject(
  fs: ModuleTextReader,
  filePath: string,
): Promise<Record<string, unknown> | null | "missing"> {
  let text: string;
  try {
    text = await fs.readTextFile(filePath);
  } catch {
    return "missing";
  }

  let parsed: unknown;
  try {
    // Comments and trailing commas are legal in a Deno config, so the strict
    // JSON reading would report a well-formed config as unreadable and send
    // every alias it declares to a bundler that has never seen it. A config
    // this parser still cannot read must not be mistaken for a project without
    // one, and stays null.
    parsed = parseExtensionManifest<unknown>(text, "jsonc", filePath);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * The mappings of a standalone import-map file a Deno config points at, or
 * null when it names something this loader cannot read as one.
 */
async function readSeparateImportMapFile(
  fs: ModuleTextReader,
  projectDir: string,
  importMapPath: unknown,
): Promise<DenoImportMap | null> {
  if (typeof importMapPath !== "string") return null;
  // Deno resolves the path against the config file, which lives at the root.
  const resolved = pathHelper.resolve(projectDir, importMapPath);
  if (!isWithinDirectory(pathHelper.resolve(projectDir), resolved)) return null;

  const map = await readJSONObject(fs, resolved);
  if (map === "missing" || map === null) return null;

  // A standalone map's relative targets and scope prefixes are resolved
  // against the map file, not against the config that names it.
  return readImportMap(map, pathHelper.dirname(resolved));
}

function readImportMap(map: Record<string, unknown>, baseDir: string): DenoImportMap | null {
  const imports = readImportMapImports(map.imports, baseDir);
  if (imports === null) return null;
  const scopes = readImportMapScopes(map.scopes, baseDir);
  return scopes === null ? null : { imports, scopes };
}

/** The declared mappings, or null when any entry is not a plain string pair. */
function readImportMapImports(
  imports: unknown,
  baseDir: string,
): Record<string, string> | null {
  if (imports === undefined) return {};
  if (typeof imports !== "object" || imports === null || Array.isArray(imports)) return null;

  const mappings: Record<string, string> = {};
  for (const [key, value] of Object.entries(imports)) {
    if (typeof value !== "string") return null;
    const normalizedKey = normalizeImportMapKey(key, baseDir);
    const normalizedTarget = normalizeImportMapTarget(value, baseDir);
    if (normalizedKey === null || normalizedTarget === null) return null;
    defineRecordEntry(mappings, normalizedKey, normalizedTarget);
  }
  return mappings;
}

function readImportMapScopes(
  scopes: unknown,
  baseDir: string,
): Record<string, Record<string, string>> | null {
  if (scopes === undefined) return {};
  if (typeof scopes !== "object" || scopes === null || Array.isArray(scopes)) return null;

  const normalized: Record<string, Record<string, string>> = {};
  for (const [prefix, imports] of Object.entries(scopes)) {
    const scoped = readImportMapImports(imports, baseDir);
    if (scoped === null) return null;
    const normalizedPrefix = normalizeImportMapScope(prefix, baseDir);
    if (normalizedPrefix === null) return null;
    defineRecordEntry(normalized, normalizedPrefix, scoped);
  }
  return normalized;
}

function defineRecordEntry<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function importMapBaseUrl(baseDir: string): URL {
  const url = pathHelper.toFileUrl(pathHelper.resolve(baseDir));
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function resolveImportMapRelativePath(value: string, baseDir: string): string {
  return pathHelper.fromFileUrl(new URL(value, importMapBaseUrl(baseDir)));
}

function preserveEncodedUrlPathDelimiters(pathname: string): string {
  return pathname.replace(/%(?:23|3[fF])/g, (encoded) => `%25${encoded.slice(1)}`);
}

function fromFileUrlPreservingEncodedUrlPathDelimiters(url: URL): string {
  const preservedUrl = new URL(url.href);
  preservedUrl.pathname = preserveEncodedUrlPathDelimiters(preservedUrl.pathname);
  return pathHelper.fromFileUrl(preservedUrl);
}

function resolveImportMapTargetPath(target: string, baseDir: string): string {
  const url = new URL(encodedModulePathOfSpecifier(target), importMapBaseUrl(baseDir));
  return fromFileUrlPreservingEncodedUrlPathDelimiters(url);
}

function withTrailingPathSeparator(path: string): string {
  return path.endsWith(pathHelper.sep) ? path : `${path}${pathHelper.sep}`;
}

function normalizeImportMapTarget(target: string, baseDir: string): string | null {
  if (/^file:/i.test(target)) return normalizeFileUrlSpecifier(target);
  if (!target.startsWith("./") && !target.startsWith("../")) return target;
  const resolved = resolveImportMapTargetPath(target, baseDir) +
    moduleSuffixOfSpecifier(target);
  return target.endsWith("/") ? withTrailingPathSeparator(resolved) : resolved;
}

function normalizeImportMapKey(key: string, baseDir: string): string | null {
  if (/^file:/i.test(key)) return normalizeFileUrlSpecifier(key);
  if (!key.startsWith("./") && !key.startsWith("../")) {
    try {
      return new URL(key).href;
    } catch {
      return key;
    }
  }
  const modulePath = modulePathOfSpecifier(key);
  const resolved = resolveImportMapRelativePath(modulePath, baseDir);
  const normalizedPath = modulePath.endsWith("/") ? withTrailingPathSeparator(resolved) : resolved;
  return normalizedPath + moduleSuffixOfSpecifier(key);
}

function normalizeFileUrlSpecifier(specifier: string): string | null {
  const moduleUrl = modulePathOfSpecifier(specifier);
  try {
    const url = new URL(moduleUrl);
    const resolved = fromFileUrlPreservingEncodedUrlPathDelimiters(url);
    const normalizedPath = url.pathname.endsWith("/")
      ? withTrailingPathSeparator(resolved)
      : resolved;
    return normalizedPath + moduleSuffixOfSpecifier(specifier);
  } catch {
    return null;
  }
}

function normalizeImportMapScope(prefix: string, baseDir: string): string | null {
  try {
    const url = new URL(prefix, importMapBaseUrl(baseDir));
    if (url.protocol !== "file:") return url.href;
    const resolved = fromFileUrlPreservingEncodedUrlPathDelimiters(url);
    return url.pathname.endsWith("/") ? withTrailingPathSeparator(resolved) : resolved;
  } catch {
    return null;
  }
}

/**
 * The target the import map selects for `specifier`, or null when it leaves it
 * alone. Matching scope prefixes are tried from longest to shortest; if none
 * maps the specifier, lookup falls back to the top-level imports.
 *
 * An exact key wins over a trailing-slash prefix, and the longest prefix wins
 * among prefixes, which is how the runtime picks between overlapping entries;
 * a prefix key carries the remaining specifier onto each of its targets.
 */
export function lookupImportMapEntry(
  importMap: DenoImportMap,
  specifier: string,
  referrer?: string,
): string | null {
  const normalizedSpecifier = normalizeImportMapLookupSpecifier(specifier, referrer);
  if (referrer !== undefined) {
    const normalizedReferrer = normalizeImportMapScopeReferrer(referrer);
    const matchingScopes = Object.entries(importMap.scopes)
      .filter(([prefix]) => normalizedReferrer.startsWith(prefix))
      .sort(([left], [right]) => right.length - left.length);
    for (const [, imports] of matchingScopes) {
      const target = lookupSpecifierMapping(imports, normalizedSpecifier);
      if (target !== null) return target;
    }
  }

  return lookupSpecifierMapping(importMap.imports, normalizedSpecifier);
}

function normalizeImportMapScopeReferrer(referrer: string): string {
  const urlLikeReferrer = normalizeImportMapUrlLikeSpecifier(referrer);
  if (urlLikeReferrer !== null) return urlLikeReferrer;
  try {
    return normalizeFileUrlSpecifier(pathHelper.toFileUrl(referrer).href) ?? referrer;
  } catch {
    return referrer;
  }
}

function normalizeImportMapLookupSpecifier(specifier: string, referrer?: string): string {
  if (
    referrer === undefined ||
    (!specifier.startsWith("./") && !specifier.startsWith("../"))
  ) {
    return normalizeImportMapUrlLikeSpecifier(specifier) ?? specifier;
  }
  if (REMOTE_URL_SPECIFIER.test(referrer)) {
    try {
      return new URL(specifier, referrer).href;
    } catch {
      return specifier;
    }
  }
  const modulePath = modulePathOfSpecifier(specifier);
  const referrerModule = modulePathOfSpecifier(referrer);
  if (REMOTE_URL_SPECIFIER.test(referrerModule)) {
    return new URL(modulePath, referrerModule).href + moduleSuffixOfSpecifier(specifier);
  }
  const localReferrer = /^file:/i.test(referrerModule)
    ? normalizeFileUrlSpecifier(referrerModule) ?? referrerModule
    : referrerModule;
  const resolved = pathHelper.fromFileUrl(
    new URL(modulePath, pathHelper.toFileUrl(localReferrer)),
  );
  return resolved + moduleSuffixOfSpecifier(specifier);
}

function normalizeImportMapUrlLikeSpecifier(specifier: string): string | null {
  if (/^file:/i.test(specifier)) return normalizeFileUrlSpecifier(specifier);
  try {
    return new URL(specifier).href;
  } catch {
    return null;
  }
}

function lookupSpecifierMapping(
  imports: Record<string, string>,
  specifier: string,
): string | null {
  if (Object.hasOwn(imports, specifier)) {
    const exact = imports[specifier];
    if (typeof exact === "string") return exact;
  }

  let longestPrefix = "";
  for (const key of Object.keys(imports)) {
    if (!key.endsWith("/") || !specifier.startsWith(key)) continue;
    if (key.length > longestPrefix.length) longestPrefix = key;
  }
  if (longestPrefix === "") return null;

  const target = imports[longestPrefix];
  if (typeof target !== "string") return null;
  const suffix = specifier.slice(longestPrefix.length);
  return target + suffix;
}

/** Direct .js imports bypass the HTTP bundler plugin exactly like the direct Deno TypeScript path; vet the graph the same way and bundle when it cannot be constrained. */
async function loadValidatedJSModule(
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  fs: FileSystem,
  config?: VeryfrontConfig,
  decoratorOptions?: TypeScriptDecoratorOptions,
  allowHostTypeScriptConfigReads = false,
): Promise<APIRoute> {
  const allowedHosts = await loadSecurityConfig(projectDir, adapter, config);
  if (await canDirectImportModuleGraph({ modulePath, projectDir, fs, allowedHosts })) {
    return loadJSModule(modulePath);
  }
  return loadAndTranspileModule(
    modulePath,
    projectDir,
    adapter,
    fs,
    config,
    decoratorOptions,
    allowHostTypeScriptConfigReads,
  );
}

function createImportMapPlugin(
  projectDir: string,
  sourceSnapshot: ProjectSourceSnapshot,
  routeModulePath: string,
  allowedHosts: string[],
  denoImports: DenoImportMap,
  workerImportMap: DenoImportMap | null,
  config?: VeryfrontConfig,
): Plugin {
  // A project's own veryfront config wins over its Deno config for the same
  // specifier, matching how the rest of the build reads resolve options.
  const configuredImports = config?.resolve?.importMap?.imports ?? {};
  const importMapEntries = new Set([
    ...Object.keys(denoImports.imports),
    ...Object.values(denoImports.scopes).flatMap((scope) => Object.keys(scope)),
    ...Object.keys(configuredImports),
  ]);

  if (importMapEntries.size === 0) return { name: "import-map", setup() {} };

  logger.debug(`Using import map with ${importMapEntries.size} entries`);

  return {
    name: "import-map",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith("node:")) return { path: args.path, external: true };

        if (
          !REMOTE_URL_SPECIFIER.test(args.path) &&
          (args.path.includes("bundle-manifest-kv") ||
            args.path.includes("bundle-manifest-redis"))
        ) {
          return { path: args.path, external: true };
        }

        if (pathHelper.isAbsolute(args.path) && args.namespace !== "import-map") return undefined;

        const configuredPath = lookupSpecifierMapping(configuredImports, args.path);
        const referrer = args.importer ||
          (args.resolveDir ? `${args.resolveDir}${pathHelper.sep}` : undefined);
        const resolvedPath = configuredPath ??
          lookupImportMapEntry(denoImports, args.path, referrer);

        if (!resolvedPath && args.namespace === "import-map" && args.path.startsWith(".")) {
          const modulePath = modulePathOfSpecifier(args.path);
          const absolutePath = resolveContainedLocalModule(projectDir, args.importer, modulePath);

          logger.debug(
            `[API] Import map relative resolve: ${args.path} (from ${args.importer}) -> ${absolutePath}`,
          );

          return {
            path: absolutePath,
            namespace: "import-map",
            suffix: moduleSuffixOfSpecifier(args.path),
          };
        }

        if (!resolvedPath) return undefined;

        if (/^(?:npm|jsr|node):/.test(resolvedPath)) {
          // The bundled route resolves an externalized target at runtime, so
          // a mapping onto a restricted runtime module must fail here.
          const restrictedReason = restrictedRuntimeModuleReason(resolvedPath);
          if (restrictedReason !== null) {
            return { errors: [{ text: restrictedReason }] };
          }
          return { path: resolvedPath, external: true };
        }

        if (INLINE_MODULE_URL_SPECIFIER.test(resolvedPath)) {
          try {
            validateModuleSpecifierHosts([resolvedPath], allowedHosts);
          } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            return { errors: [{ text }] };
          }
          return { path: resolvedPath, external: true };
        }

        if (REMOTE_URL_SPECIFIER.test(resolvedPath)) {
          // Hand it to the HTTP plugin's namespace rather than to esbuild's
          // default resolver, which cannot fetch a URL: that plugin is what
          // enforces the remote allow-list on the module and its own imports.
          logger.debug(`Import map resolved to HTTP URL: ${args.path} -> ${resolvedPath}`);
          return { path: resolvedPath, namespace: "http-url" };
        }

        const mappedModulePath = modulePathOfSpecifier(resolvedPath);
        const absolutePath = pathHelper.isAbsolute(resolvedPath)
          ? resolveContainedLocalModule(projectDir, args.importer || projectDir, resolvedPath)
          : pathHelper.resolve(projectDir, mappedModulePath);

        if (!isWithinDirectory(pathHelper.resolve(projectDir), absolutePath)) {
          logger.error(
            `[API] Import map entry escapes project directory: ${args.path} -> ${absolutePath}`,
          );
          return { errors: [{ text: `Import map path escapes project: ${args.path}` }] };
        }

        logger.debug(`Import map resolved: ${args.path} -> ${absolutePath}`);

        return {
          path: absolutePath,
          namespace: "import-map",
          suffix: moduleSuffixOfSpecifier(resolvedPath),
        };
      });

      build.onLoad(
        { filter: /.*/, namespace: "import-map" },
        createNamespaceOnLoadHandler({
          sourceSnapshot,
          projectDir,
          routeModulePath,
          errorLabel: "file via import map",
          allowedHosts,
          workerImportMap,
        }),
      );
    },
  };
}

function createNamespaceOnLoadHandler(options: {
  sourceSnapshot: ProjectSourceSnapshot;
  projectDir: string;
  routeModulePath: string;
  errorLabel: string;
  allowedHosts: string[];
  workerImportMap: DenoImportMap | null;
}) {
  const {
    sourceSnapshot,
    projectDir,
    routeModulePath,
    errorLabel,
    allowedHosts,
    workerImportMap,
  } = options;

  return wrapWithCurrentContext(async (args: { path: string }) => {
    try {
      const { filePath, contents } = await readFileWithExtensions(
        sourceSnapshot,
        args.path,
        FILE_EXTENSIONS,
        projectDir,
      );
      const executableModule = !isJSONModulePath(filePath);
      // A `.json` module is data the bundler parses as JSON, so it can neither
      // execute nor name an import. Scanning it as JavaScript would reject an
      // ordinary value such as `{ "label": "Function" }`.
      if (executableModule) {
        const scan = await validateHTTPImports(contents, allowedHosts);
        await validateBundledLocalWorkerEntries({
          sourceSnapshot,
          projectDir,
          routeModulePath,
          modulePath: filePath,
          scan,
          allowedHosts,
          importMap: workerImportMap,
        });
      }

      return {
        contents: executableModule
          ? await rewriteBundledImportMetaUrl(
            contents,
            pathHelper.toFileUrl(filePath).href,
            workerImportMap,
          )
          : contents,
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

async function rewriteBundledImportMetaUrl(
  source: string,
  moduleUrl: string,
  importMap: DenoImportMap | null,
): Promise<string> {
  const rewritten = await rewriteImportMetaLocations(
    source,
    moduleUrl,
    (specifier, referrer) => resolveBundledImportMetaSpecifier(specifier, referrer, importMap),
  );
  if (rewritten !== null) return rewritten;
  throw new TypeError(
    "[API] handler build failed: import.meta location cannot be preserved because the module source could not be parsed or its resolver is dynamic",
  );
}

function resolveBundledImportMetaSpecifier(
  specifier: string,
  moduleUrl: string,
  importMap: DenoImportMap | null,
): string | null {
  const mapped = importMap === null ? null : lookupImportMapEntry(importMap, specifier, moduleUrl);
  if (mapped === null && isBareModuleSpecifier(specifier)) return null;
  const target = mapped ?? specifier;
  const targetPath = modulePathOfSpecifier(target);
  if (pathHelper.isAbsolute(targetPath)) {
    return pathHelper.toFileUrl(targetPath).href + moduleSuffixOfSpecifier(target);
  }
  try {
    return new URL(target, moduleUrl).href;
  } catch {
    return null;
  }
}

function createRouteRuntimeShimPlugin(contents: string): Plugin {
  return {
    name: "vf-route-runtime-shim",
    setup(build) {
      build.onResolve({ filter: /^veryfront:route-runtime-shim$/ }, () => ({
        path: ROUTE_RUNTIME_SHIM_SPECIFIER,
        namespace: ROUTE_RUNTIME_SHIM_NAMESPACE,
      }));
      build.onLoad(
        { filter: /.*/, namespace: ROUTE_RUNTIME_SHIM_NAMESPACE },
        () => ({ contents, loader: "js" }),
      );
    },
  };
}

async function validateBundledLocalWorkerEntries(options: {
  sourceSnapshot: ProjectSourceSnapshot;
  projectDir: string;
  routeModulePath: string;
  modulePath: string;
  scan: ValidatedModuleScan;
  allowedHosts: string[];
  importMap: DenoImportMap | null;
}): Promise<void> {
  const {
    sourceSnapshot,
    projectDir,
    routeModulePath,
    modulePath,
    scan,
    allowedHosts,
    importMap,
  } = options;
  const visited = new Set<string>();
  for (const worker of scan.localWorkerSpecifiers) {
    const importer = worker.resolutionBase === "route" ? routeModulePath : modulePath;
    const workerPath = resolveContainedLocalModule(projectDir, importer, worker.specifier);
    await validateBundledLocalWorkerGraph({
      sourceSnapshot,
      projectDir,
      entryPath: workerPath,
      allowedHosts,
      importMap,
      visited,
    });
  }
  if (scan.localWorkerSpecifiers.length > 0) {
    throw toError(
      createError({
        type: "api",
        message:
          "[API] handler build failed: local Worker modules are mutable after validation and cannot be started safely from an API route.",
      }),
    );
  }
}

async function validateBundledLocalWorkerGraph(options: {
  sourceSnapshot: ProjectSourceSnapshot;
  projectDir: string;
  entryPath: string;
  allowedHosts: string[];
  importMap: DenoImportMap | null;
  visited: Set<string>;
}): Promise<void> {
  const { sourceSnapshot, projectDir, entryPath, allowedHosts, importMap, visited } = options;
  const pending = [entryPath];

  while (pending.length > 0) {
    const nextPath = pending.pop() as string;
    const { filePath, contents } = await readFileWithExtensions(
      sourceSnapshot,
      nextPath,
      FILE_EXTENSIONS,
      projectDir,
    );
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    if (isJSONModulePath(filePath)) continue;

    const scan = await validateHTTPImports(contents, allowedHosts);
    for (const specifier of scan.specifiers) {
      const localTarget = bundledWorkerImportTarget({
        specifier,
        filePath,
        projectDir,
        allowedHosts,
        importMap,
      });
      if (localTarget !== null) pending.push(localTarget);
    }

    for (const worker of scan.localWorkerSpecifiers) {
      pending.push(resolveContainedLocalModule(projectDir, filePath, worker.specifier));
    }
  }
}

function bundledWorkerImportTarget(options: {
  specifier: string;
  filePath: string;
  projectDir: string;
  allowedHosts: string[];
  importMap: DenoImportMap | null;
}): string | null {
  const { specifier, filePath, projectDir, allowedHosts, importMap } = options;
  const mappedTarget = importMap === null
    ? null
    : lookupImportMapEntry(importMap, specifier, filePath);
  if (mappedTarget !== null) {
    return validatedWorkerImportTarget({
      originalSpecifier: specifier,
      target: mappedTarget,
      filePath,
      projectDir,
      allowedHosts,
    });
  }

  // An inherited or otherwise unreadable map can remap even a relative
  // Worker import. The worker runs under Deno's loader rather than esbuild, so
  // validating the literal path would approve a graph different from the one
  // that executes.
  if (importMap === null) rejectUnvalidatedWorkerImport(specifier);

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return resolveContainedLocalModule(projectDir, filePath, specifier);
  }
  if (specifier.startsWith("#")) return rejectUnvalidatedWorkerImport(specifier);
  if (canDirectImportSpecifier(specifier)) return null;
  if (isBareModuleSpecifier(specifier)) {
    return null;
  }
  if (REMOTE_URL_SPECIFIER.test(specifier)) return rejectRemoteWorkerImport(specifier);
  return rejectUnvalidatedWorkerImport(specifier);
}

function validatedWorkerImportTarget(options: {
  originalSpecifier: string;
  target: string;
  filePath: string;
  projectDir: string;
  allowedHosts: string[];
}): string | null {
  const { originalSpecifier, target, filePath, projectDir, allowedHosts } = options;
  const restrictedReason = restrictedRuntimeModuleReason(target);
  if (restrictedReason !== null) {
    throw toError(
      createError({
        type: "api",
        message: `[API] handler build failed: ${restrictedReason}.`,
      }),
    );
  }
  if (pathHelper.isAbsolute(modulePathOfSpecifier(target))) {
    return resolveContainedLocalModule(projectDir, filePath, target);
  }
  if (canDirectImportSpecifier(target)) return null;
  validateModuleSpecifierHosts([target], allowedHosts);
  if (REMOTE_URL_SPECIFIER.test(target)) return rejectRemoteWorkerImport(originalSpecifier);
  return rejectUnvalidatedWorkerImport(originalSpecifier);
}

function rejectRemoteWorkerImport(specifier: string): never {
  throw toError(
    createError({
      type: "api",
      message:
        `[API] handler build failed: Worker remote import cannot be validated transitively: ${specifier}`,
    }),
  );
}

function rejectUnvalidatedWorkerImport(specifier: string): never {
  throw toError(
    createError({
      type: "api",
      message:
        `[API] handler build failed: Worker import cannot be validated against the remote import allow-list: ${specifier}`,
    }),
  );
}

/** Resolves the framework's built-in @/ project alias through the runtime adapter. */
function createProjectAliasPlugin(
  sourceSnapshot: ProjectSourceSnapshot,
  projectDir: string,
  routeModulePath: string,
  allowedHosts: string[],
  workerImportMap: DenoImportMap | null,
): Plugin {
  const projectRoot = pathHelper.resolve(projectDir);

  return {
    name: "vf-project-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const aliasedPath = args.path.slice(2);
        const absolutePath = pathHelper.resolve(projectRoot, modulePathOfSpecifier(aliasedPath));
        if (!isWithinDirectory(projectRoot, absolutePath)) {
          logger.error(
            `[API] Project alias escapes project: ${args.path} -> ${absolutePath}`,
          );
          return { errors: [{ text: `Project alias escapes project: ${args.path}` }] };
        }

        return {
          path: absolutePath,
          namespace: "vf-project-alias",
          suffix: moduleSuffixOfSpecifier(aliasedPath),
        };
      });

      build.onLoad(
        { filter: /.*/, namespace: "vf-project-alias" },
        createNamespaceOnLoadHandler({
          sourceSnapshot,
          projectDir,
          routeModulePath,
          errorLabel: "via project alias",
          allowedHosts,
          workerImportMap,
        }),
      );
    },
  };
}

/** Resolves relative imports through the adapter's virtual FS for remote projects. */
function createAdapterResolvePlugin(
  sourceSnapshot: ProjectSourceSnapshot,
  projectDir: string,
  routeModulePath: string,
  allowedHosts: string[],
  workerImportMap: DenoImportMap | null,
): Plugin {
  return {
    name: "vf-adapter-resolve",
    setup(build) {
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        if (args.namespace === "http-url" || args.namespace === "import-map") return undefined;

        const baseDir = args.importer ? pathHelper.dirname(args.importer) : args.resolveDir;
        if (!baseDir) return undefined;

        const modulePath = modulePathOfSpecifier(args.path);
        const absolutePath = pathHelper.resolve(baseDir, modulePath);

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
        return {
          path: absolutePath,
          namespace: "vf-adapter",
          suffix: moduleSuffixOfSpecifier(args.path),
        };
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
          routeModulePath,
          errorLabel: "via adapter",
          allowedHosts,
          workerImportMap,
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
  projectDir: string,
  routeModulePath: string,
  allowedHosts: string[],
  workerImportMap: DenoImportMap | null,
): Plugin {
  return {
    name: "vf-project-boundary",
    setup(build) {
      build.onLoad({ filter: /.*/ }, async (args) => {
        try {
          const source = await sourceSnapshot.read(args.path);
          const executableModule = !isJSONModulePath(source.logicalPath);
          // JSON is parsed as data, never executed; see the note above.
          if (executableModule) {
            const scan = await validateHTTPImports(source.contents, allowedHosts);
            await validateBundledLocalWorkerEntries({
              sourceSnapshot,
              projectDir,
              routeModulePath,
              modulePath: source.logicalPath,
              scan,
              allowedHosts,
              importMap: workerImportMap,
            });
          }
          return {
            contents: executableModule
              ? await rewriteBundledImportMetaUrl(
                source.contents,
                pathHelper.toFileUrl(source.logicalPath).href,
                workerImportMap,
              )
              : source.contents,
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
  decoratorOptions?: TypeScriptDecoratorOptions,
  allowHostTypeScriptConfigReads = false,
): Promise<APIRoute> {
  const source = await buildTranspiledModuleSource(
    modulePath,
    projectDir,
    adapter,
    config,
    decoratorOptions,
    allowHostTypeScriptConfigReads,
  );
  return await loadModuleFromCode(
    source,
    fs,
    `${projectDir}\u0000${modulePath}\u0000${await bundledModuleScopeDiscriminator()}`,
  );
}

function buildTranspiledModuleSource(
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
  resolvedDecoratorOptions?: TypeScriptDecoratorOptions,
  allowHostTypeScriptConfigReads = false,
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
      const workerImportMap = await readDenoImportMap(sourceSnapshot, projectDir);
      const sourceScan = await validateHTTPImports(source, allowedHosts);
      await validateBundledLocalWorkerEntries({
        sourceSnapshot,
        projectDir,
        routeModulePath: resolvedPath,
        modulePath: resolvedPath,
        scan: sourceScan,
        allowedHosts,
        importMap: workerImportMap,
      });

      // Read through the project snapshot, so an adapter-backed project's own
      // config is visible: the host filesystem cannot see one. An undecidable
      // config contributes nothing: those specifiers resolve exactly as they
      // did before the map was consulted.
      const denoImports = workerImportMap ?? {
        imports: {},
        scopes: {},
      };

      const allDeps = await readProjectDependencies(projectDir, sourceSnapshot);
      const typeScriptBundler = selectedTypeScriptBundler();
      const typescriptDecoratorOptions = resolvedDecoratorOptions ??
        (typeScriptBundler
          ? await readProjectTypeScriptDecoratorOptions(
            projectDir,
            sourceSnapshot,
            allowHostTypeScriptConfigReads,
          )
          : undefined);
      const bundleTypeScript = typescriptDecoratorOptions !== undefined &&
        bundlerForcesTypeScript(typeScriptBundler, typescriptDecoratorOptions);

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
      const routeSourceUrl = pathHelper.toFileUrl(resolvedPath).href;
      const workerShim = [
        `const __vf_routeSourceUrl = ${JSON.stringify(routeSourceUrl)};`,
        `const Worker = typeof globalThis.Worker === "function" ? class extends globalThis.Worker {`,
        `  constructor(specifier, options) {`,
        `    super(typeof specifier === "string" && (specifier.startsWith("./") || specifier.startsWith("../")) ? new URL(specifier, __vf_routeSourceUrl) : specifier, options);`,
        `  }`,
        `} : globalThis.Worker;`,
      ].join("\n");
      const routeRuntimeShim = [
        requireShim,
        workerShim,
        "export { require, Worker };",
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
        // Injection binds only free identifiers and lets esbuild rename either
        // side of a collision. A raw banner would redeclare a route import such
        // as `import { Worker } from "worker-package"` and emit invalid ESM.
        inject: [ROUTE_RUNTIME_SHIM_SPECIFIER],
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
          contents: await rewriteBundledImportMetaUrl(source, routeSourceUrl, denoImports),
          loader,
          resolveDir: pathHelper.dirname(resolvedPath),
          sourcefile: resolvedPath,
        },
        plugins: [
          createRouteRuntimeShimPlugin(routeRuntimeShim),
          createImportMapPlugin(
            projectDir,
            sourceSnapshot,
            resolvedPath,
            allowedHosts,
            denoImports,
            workerImportMap,
            config,
          ),
          createProjectAliasPlugin(
            sourceSnapshot,
            projectDir,
            resolvedPath,
            allowedHosts,
            workerImportMap,
          ),
          createAdapterResolvePlugin(
            sourceSnapshot,
            projectDir,
            resolvedPath,
            allowedHosts,
            workerImportMap,
          ),
          createHTTPPlugin({
            allowedHosts,
            projectDir,
            resolveImportMetaSpecifier: (specifier, referrer) =>
              resolveBundledImportMetaSpecifier(specifier, referrer, denoImports),
          }),
          createProjectBoundaryPlugin(
            sourceSnapshot,
            projectDir,
            resolvedPath,
            allowedHosts,
            workerImportMap,
          ),
        ],
        // Only the opt-in decorator transform needs a working directory: adding
        // it unconditionally would change how the default esbuild path reports
        // paths for every project.
        ...(typescriptDecoratorOptions
          ? typeScriptBuildOptions(projectDir, typescriptDecoratorOptions, bundleTypeScript)
          : {}),
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

/**
 * Bundled route modules, keyed by owner and generated source.
 *
 * The bundling path builds its module from generated source and imports it from
 * a throwaway temp file, so an unchanged route produced a brand new module on
 * every request: module-level state (clients, caches, pools) reset between
 * requests, while the same code under `veryfront serve` kept it. Caching on the
 * generated source keeps an unchanged route on the module it already has, and
 * changed source hashes differently and rebuilds.
 *
 * The key carries the project and route path as well as the code, so two
 * projects that happen to bundle byte-identical output never share a module,
 * and with it module state. Hosted projects can share one virtual project dir,
 * so the owner also carries the request's scope discriminator: the registry
 * scope (project, mode, version) and a digest of the active project-env
 * overlay. A module whose top-level init ran under one tenant's or
 * environment's env overlay is never reused under another.
 */
interface BundledModuleRecord {
  readonly loading: Promise<APIRoute>;
}

const bundledModules = new IntrinsicMap<string, BundledModuleRecord>();

/**
 * Identity of the scope a bundled module may be reused within.
 *
 * In proxy mode every hosted project resolves to the host runtime's shared
 * project dir, and per-request env isolation (`runWithProjectEnv`) hands each
 * scope its own env overlay, so `projectDir`/`modulePath`/code alone would let
 * a module initialized under one project's or environment's overlay serve a
 * later request in a different scope — leaking module-level clients, secrets,
 * and mutable state across tenants. Fold the ambient registry scope (project,
 * mode, version) and a digest of the active env overlay into the owner so
 * reuse stays within one scope. Local single-tenant loads carry neither and
 * keep their current key.
 */
export async function bundledModuleScopeDiscriminator(): Promise<string> {
  const scopeId = tryGetRegistryScopeId() ?? "";
  const environmentName = trustedRequestContextAccessor()?.environmentName ?? "";
  const envSnapshot = getProjectEnvSnapshot();
  let serializedEnv = "";
  if (envSnapshot) {
    // Project code executes in this realm and can replace ordinary Object and
    // Array methods. The snapshot is a frozen, null-prototype record whose own
    // keys were inserted in deterministic order, so captured own-key traversal
    // plus length framing gives a canonical encoding without crossing a
    // mutable prototype.
    const keys = IntrinsicReflectOwnKeys(envSnapshot);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") continue;
      const value = envSnapshot[key]!;
      serializedEnv += `${key.length}:${key}${value.length}:${value}`;
    }
  }

  // Raw UTF-16 framing keeps lone surrogates distinct from U+FFFD. TextEncoder
  // normalizes both to the same UTF-8 replacement bytes.
  return await computeCodeHash({
    code: scopeId,
    css: environmentName,
    sourceMap: serializedEnv,
  });
}

async function bundledModuleKey(owner: string, code: string): Promise<string> {
  return await computeCodeHash({ code: owner, css: code });
}

export async function loadModuleFromCode(
  code: string,
  fs: FileSystem,
  owner: string,
): Promise<APIRoute> {
  const key = await bundledModuleKey(owner, code);
  const cached = IntrinsicReflectApply(MapPrototypeGet, bundledModules, [key]) as
    | BundledModuleRecord
    | undefined;
  if (cached) return await cached.loading;

  const loading = importModuleFromCode(code, fs);
  const record = { loading } satisfies BundledModuleRecord;
  IntrinsicReflectApply(MapPrototypeSet, bundledModules, [key, record]);

  // Deno retains every imported ESM record for the life of the process. Keep
  // one matching lookup entry too: evicting only this map caused a later visit
  // to import the same scope under a fresh temp URL, retaining a duplicate ESM
  // record and resetting its module state each time.
  try {
    return await loading;
  } catch (error) {
    if (IntrinsicReflectApply(MapPrototypeGet, bundledModules, [key]) === record) {
      IntrinsicReflectApply(MapPrototypeDelete, bundledModules, [key]);
    }
    throw error;
  }
}

async function importModuleFromCode(
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
