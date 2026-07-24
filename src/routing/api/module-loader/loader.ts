import { isCompiledBinary, serverLogger } from "#veryfront/utils";
import type { BuildResult, ModuleLexer, Plugin } from "veryfront/extensions/bundler";
import { resolve as resolveExtensionContract } from "#veryfront/extensions/contracts.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createHTTPPlugin } from "./esbuild-plugin.ts";
import { validateHTTPImports } from "./http-validator.ts";
import { loadSecurityConfig } from "./security-config.ts";
import type { APIRoute, LoadModuleOptions } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import { createFileSystem, realPath } from "#veryfront/platform/compat/fs.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { FILE_EXTENSIONS, getLoaderForFile, validateModulePath } from "./loader-helpers.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { wrapWithCurrentContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { isWithinDirectory, validatePath } from "#veryfront/security/path-validation.ts";
import {
  generateCompiledBinaryRequireShim,
  NODE_BUILTINS,
  readProjectDependencies,
  rewriteExternalImports,
} from "./external-import-rewriter.ts";
import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
  snapshotThrowableDiagnostic,
} from "#veryfront/errors/safe-diagnostics.ts";
import {
  MAX_WORKER_MODULE_SOURCE_BYTES,
  type PreparedWorkerModule,
} from "#veryfront/security/sandbox/worker-types.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
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
const apply = Reflect.apply;
const NativeArray = Array;
const NativeTextEncoder = TextEncoder;
const NativeUint8Array = Uint8Array;
const utf8Encoder = new NativeTextEncoder();
const textEncoderEncode = NativeTextEncoder.prototype.encode;
const subtleDigest = SubtleCrypto.prototype.digest;
const numberToString = Number.prototype.toString;
const stringPadStart = String.prototype.padStart;
const arrayJoin = Array.prototype.join;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const MAX_NOT_FOUND_CAUSE_DEPTH = 16;
const denoNotFoundPrototype = (
  globalThis as typeof globalThis & {
    Deno?: { errors?: { NotFound?: { prototype: object } } };
  }
).Deno?.errors?.NotFound?.prototype;

export { toCjsDestructureBindings } from "./loader-helpers.ts";

async function hashPreparedSource(bytes: Uint8Array): Promise<string> {
  const digest = await apply(subtleDigest, crypto.subtle, ["SHA-256", bytes]) as ArrayBuffer;
  const digestBytes = new NativeUint8Array(digest);
  const hex = new NativeArray<string>(digestBytes.byteLength);
  for (let index = 0; index < digestBytes.byteLength; index++) {
    const encoded = apply(numberToString, digestBytes[index]!, [16]) as string;
    hex[index] = apply(stringPadStart, encoded, [2, "0"]) as string;
  }
  return apply(arrayJoin, hex, [""]) as string;
}

/**
 * Build and rewrite a route for worker execution without evaluating project
 * code in the host process.
 */
export function prepareHandlerModule(
  options: LoadModuleOptions,
): Promise<PreparedWorkerModule> {
  return withSpan(
    "api.prepareHandlerModule",
    async () => {
      const { projectDir, modulePath, adapter, config } = options;

      if (isDeno && isCompiledBinary()) {
        throw toError(
          createError({
            type: "not_supported",
            message:
              "Worker-isolated API routes are unavailable in compiled binaries until framework runtime shims are worker-owned",
            feature: "compiled-binary worker API isolation",
          }),
        );
      }

      if (isVirtualFilesystem(adapter.fs)) {
        throw toError(
          createError({
            type: "not_supported",
            message:
              "Worker-isolated API routes cannot prepare remote virtual-filesystem sources until dependency, lockfile, and runtime filesystem capabilities are snapshot-owned",
            feature: "virtual-filesystem worker API isolation",
          }),
        );
      }

      validateModulePath(modulePath, projectDir);

      const fs = createFileSystem();
      try {
        const built = await buildModule({
          modulePath,
          projectDir,
          adapter,
          fs,
          config,
          strictRemoteImports: true,
        });
        const preparedDependencies = new Map(built.userDeps);
        // zod remains external to the bundle, so strict preparation must pin
        // its installed version just like a project-declared dependency. The
        // declared value is intentionally unused in strict mode.
        preparedDependencies.set("zod", "");
        const source = await rewriteExternalImports(
          built.code,
          built.projectDir,
          fs,
          preparedDependencies,
          {
            preparedWorker: true,
            requireInstalledExactVersions: true,
          },
        );
        const sourceBytes = apply(textEncoderEncode, utf8Encoder, [source]) as Uint8Array;
        if (sourceBytes.byteLength > MAX_WORKER_MODULE_SOURCE_BYTES) {
          throw toError(
            createError({
              type: "api",
              message:
                `Prepared API route exceeds worker source limit (${sourceBytes.byteLength} bytes, limit ${MAX_WORKER_MODULE_SOURCE_BYTES} bytes)`,
            }),
          );
        }

        return {
          source,
          sha256: await hashPreparedSource(sourceBytes),
        };
      } catch (error) {
        const errorMsg = snapshotThrowableDiagnostic(error);
        logger.error(`Failed to prepare isolated API handler ${modulePath}: ${errorMsg}`);
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
        const errorMsg = snapshotThrowableDiagnostic(error);
        logger.error(`Failed to load API handler ${modulePath}: ${errorMsg}`);
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
  const built = await buildModule({
    modulePath,
    projectDir,
    adapter,
    fs,
    config,
  });
  return loadModuleFromCode(
    built.code,
    built.projectDir,
    fs,
    built.userDeps,
  );
}

interface BuiltHandlerModule {
  readonly code: string;
  readonly projectDir: string;
  readonly userDeps: Map<string, string>;
}

async function buildModule(args: {
  modulePath: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  fs: FileSystem;
  config?: VeryfrontConfig;
  strictRemoteImports?: boolean;
}): Promise<BuiltHandlerModule> {
  const resolved = await resolveLocalModuleLocation(
    args.modulePath,
    args.projectDir,
    args.fs,
  );
  const built = await buildAndTranspileModule(
    resolved.modulePath,
    resolved.projectDir,
    args.adapter,
    args.fs,
    args.config,
    args.strictRemoteImports,
  );
  return {
    ...built,
    projectDir: resolved.projectDir,
  };
}

/**
 * Canonicalize a handler that exists on the host filesystem before an adapter
 * or bundler can read it.
 *
 * Remote adapters use virtual paths that do not exist on the host and therefore
 * retain their lexical path. A local entry point is pinned to its canonical
 * target, preventing a symlink from escaping the project or being swapped
 * between validation and the subsequent adapter read.
 */
async function resolveLocalModuleLocation(
  modulePath: string,
  projectDir: string,
  fs: FileSystem,
): Promise<{ modulePath: string; projectDir: string }> {
  for (const extension of FILE_EXTENSIONS) {
    const candidate = extension ? modulePath + extension : modulePath;
    if (!await fs.exists(candidate)) continue;

    const [canonicalProjectDir, canonicalModulePath] = await Promise.all([
      realPath(pathHelper.resolve(projectDir)),
      realPath(pathHelper.resolve(candidate)),
    ]);
    validateModulePath(canonicalModulePath, canonicalProjectDir);
    return {
      modulePath: canonicalModulePath,
      projectDir: canonicalProjectDir,
    };
  }

  return { modulePath, projectDir };
}

function toModuleFileUrl(modulePath: string): URL {
  return modulePath.startsWith("file:") ? new URL(modulePath) : pathHelper.toFileUrl(modulePath);
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
      const msg = snapshotThrowableDiagnostic(error);
      logger.error(`Failed to load ${errorLabel}: ${args.path}: ${msg}`);
      return { errors: [{ text: `Failed to load: ${msg}` }] };
    }
  });
}

/** Resolves the framework's built-in @/ project alias through the runtime adapter. */
function createProjectAliasPlugin(
  adapter: RuntimeAdapter,
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
          adapter,
          projectDir,
          errorLabel: "via project alias",
        }),
      );
    },
  };
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

/**
 * Refuse to load any file the bundle resolved outside the project.
 *
 * The resolver plugins above validate the specifiers they claim, but esbuild
 * applies the project's own tsconfig `paths` itself, before any `onResolve`
 * callback runs. A templated project maps `@/*` to `./*`, so `@/../secrets.ts`
 * is resolved by esbuild straight to a path above the project root and loaded
 * in the default namespace, where none of those guards ever see it.
 *
 * This runs at load time instead, which is the one point every resolution
 * strategy converges on. Returning `undefined` defers to normal loading, so the
 * plugin only ever subtracts. Package code in a `node_modules` directory that
 * Node's resolver can reach from the project is exempt. This includes packages
 * hoisted above the project in a monorepo without trusting an unrelated path
 * merely because one of its segments happens to be named `node_modules`.
 *
 * `roots` carries both the project path as configured and its symlink-resolved
 * form, because esbuild reports the real path of a file it loaded. A project
 * reached through a symlink (`/var` -> `/private/var` on macOS, and any deploy
 * layout that symlinks a release directory) would otherwise fail every import.
 */
/**
 * The project path as configured, plus its symlink-resolved form when they
 * differ. `realPath` throws if the directory is missing, in which case the
 * configured path is all there is to compare against.
 */
async function resolveProjectRoots(projectDir: string): Promise<string[]> {
  const configured = pathHelper.resolve(projectDir);

  try {
    const real = await realPath(configured);
    return real === configured ? [configured] : [configured, real];
  } catch {
    return [configured];
  }
}

function createProjectBoundaryPlugin(roots: string[]): Plugin {
  const packageSearchRoots = new Set<string>();
  for (const root of roots) {
    let directory = pathHelper.resolve(root);
    while (true) {
      packageSearchRoots.add(pathHelper.join(directory, "node_modules"));
      const parent = pathHelper.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  return {
    name: "vf-project-boundary",
    setup(build) {
      build.onLoad({ filter: /.*/ }, (args) => {
        if (roots.some((root) => isWithinDirectory(root, args.path))) return undefined;
        if ([...packageSearchRoots].some((root) => isWithinDirectory(root, args.path))) {
          return undefined;
        }

        logger.error(`[API] Resolved import escapes project: ${args.path}`);
        return {
          errors: [{
            text: `Import escapes the project directory: ${args.path}. ` +
              `API routes may only import files inside the project.`,
          }],
        };
      });
    },
  };
}

/**
 * Reject dynamic imports whose target remains unknown after bundling.
 *
 * Literal dynamic imports are resolved by the bundler and therefore pass
 * through the project-boundary plugin. An expression such as `import(path)`
 * survives in the generated module and would otherwise execute later from the
 * unrestricted server process, outside every resolver guard.
 */
async function assertNoUnresolvedDynamicImports(code: string): Promise<void> {
  const lexer = resolveExtensionContract<ModuleLexer>("ModuleLexer");
  await lexer.init?.();

  if (!lexer.parse(code).some((specifier) => specifier.d >= 0 && specifier.n === undefined)) {
    return;
  }

  throw toError(
    createError({
      type: "api",
      message:
        "[API] handler build rejected: non-literal dynamic import targets cannot be constrained to the project directory",
    }),
  );
}

function buildAndTranspileModule(
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  fs: FileSystem,
  config?: VeryfrontConfig,
  strictRemoteImports = false,
): Promise<Omit<BuiltHandlerModule, "projectDir">> {
  return withSpan(
    "api.buildAndTranspileModule",
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
          createImportMapPlugin(projectDir, adapter, config),
          createProjectAliasPlugin(adapter, projectDir),
          createAdapterResolvePlugin(adapter, projectDir),
          createHTTPPlugin({ allowedHosts, projectDir, strict: strictRemoteImports }),
          createProjectBoundaryPlugin(await resolveProjectRoots(projectDir)),
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
      await assertNoUnresolvedDynamicImports(js);
      logger.debug(`transpiled size ${js.length} bytes`);

      return { code: js, userDeps };
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

    const readPath = resolvedProjectDir
      ? await resolveAdapterReadPath(adapter, filePath, resolvedProjectDir)
      : filePath;
    try {
      const contents = await adapter.fs.readFile(readPath);
      return { filePath: readPath, contents };
    } catch (error) {
      if (!isSafeNotFoundError(error)) {
        throw toError(
          createError({
            type: "api",
            message: snapshotThrowableDiagnostic(error),
          }),
        );
      }
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

function isSafeNotFoundError(
  error: unknown,
  seen: Set<unknown> = new Set(),
  depth = 0,
): boolean {
  if (
    error === null ||
    (typeof error !== "object" && typeof error !== "function") ||
    depth >= MAX_NOT_FOUND_CAUSE_DEPTH ||
    seen.has(error) ||
    isProxyWithoutHooks(error)
  ) {
    return false;
  }
  seen.add(error);

  try {
    const code = getOwnPropertyDescriptor(error, "code");
    if (code !== undefined && "value" in code && code.value === "ENOENT") {
      return true;
    }

    if (!isNativeErrorWithoutHooks(error)) return false;
    if (
      denoNotFoundPrototype !== undefined &&
      getPrototypeOf(error) === denoNotFoundPrototype
    ) {
      return true;
    }

    const name = getOwnPropertyDescriptor(error, "name");
    const slug = getOwnPropertyDescriptor(error, "slug");
    if (
      name !== undefined &&
      "value" in name &&
      name.value === "VeryfrontError" &&
      slug !== undefined &&
      "value" in slug &&
      slug.value === "file-not-found"
    ) {
      return true;
    }

    const cause = getOwnPropertyDescriptor(error, "cause");
    return cause !== undefined &&
      "value" in cause &&
      cause.value !== undefined &&
      isSafeNotFoundError(cause.value, seen, depth + 1);
  } catch {
    return false;
  }
}

/** @internal Exported for cross-runtime path-boundary regression tests. */
export async function resolveAdapterReadPath(
  adapter: RuntimeAdapter,
  filePath: string,
  projectDir: string,
): Promise<string> {
  if (typeof adapter.fs.realPath !== "function") {
    if (typeof adapter.fs.lstat === "function") {
      throw toError(
        createError({
          type: "api",
          message:
            "[API] cannot safely load local modules: adapter.fs.realPath is required when symlinks are supported",
        }),
      );
    }
    return filePath;
  }

  const validation = await validatePath(filePath, {
    level: "normal",
    baseDir: projectDir,
    followSymlinks: true,
    adapter,
    allowAbsolute: true,
  });
  if (!validation.valid || !validation.canonicalPath) {
    throw toError(
      createError({
        type: "api",
        message: `[API] file path escapes project directory: ${filePath}`,
      }),
    );
  }
  return validation.canonicalPath;
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
    const importUrl = toModuleFileUrl(tempFile);
    importUrl.searchParams.set("v", Date.now().toString());
    return await import(importUrl.href);
  } catch (e: unknown) {
    const errorMessage = snapshotThrowableDiagnostic(e);
    logger.error(`dynamic import failed ${tempFile}: ${errorMessage}`);
    throw toError(createError({ type: "api", message: errorMessage }));
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
      logger.warn(
        `[API] Failed to register veryfront/${subpath}: ${snapshotThrowableDiagnostic(e)}`,
      );
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
