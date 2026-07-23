/**
 * Module Transpiler
 *
 * Handles transpilation and bundling of TypeScript modules
 * for dynamic import during discovery.
 */

import type { Plugin, PluginBuild } from "veryfront/extensions/bundler";
import { ensureDefaultBundlerContracts } from "#veryfront/extensions/bundler/defaults.ts";
import { isDeno, isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DiscoveryModuleImportOptions, FileDiscoveryContext } from "./types.ts";
import { rewriteDiscoveryImports, rewriteForDeno } from "./import-rewriter.ts";
import { COMPILATION_ERROR, FILE_NOT_FOUND } from "#veryfront/errors";
import { wrapWithCurrentContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { installDiscoveryRuntimeModulesGlobal } from "./runtime-modules.ts";
import {
  runWithSharedRegistryMutationsDisabled,
} from "#veryfront/registry/project-scoped-registry-manager.ts";
import {
  assertDiscoveryPathLexicallyWithinBase,
  assertDiscoveryPathWithinBase,
  discoveryFileUrlToPath,
} from "./file-discovery.ts";

type TranspileCacheEntry = {
  /** Content hashes of every file esbuild bundled into the module besides the entry. */
  deps: ReadonlyArray<{ path: string; hash: string }>;
  module: unknown;
};

const MAX_TRANSPILE_CACHE_ENTRIES = 256;
const MAX_DEPENDENCY_VARIANTS_PER_MODULE = 4;
const MAX_DISCOVERY_SOURCE_BYTES = 2 * 1_024 * 1_024;
const MAX_DISCOVERY_BUNDLE_BYTES = 8 * 1_024 * 1_024;
const MAX_DISCOVERY_DEPENDENCIES = 1_000;
const MAX_DISCOVERY_DEPENDENCY_BYTES = 16 * 1_024 * 1_024;
const MAX_DISCOVERY_RESOLUTION_ATTEMPTS = 12_000;
const FILESYSTEM_IMPORT_PATTERN = /^(?:\.{1,2}[\\/]|[\\/]|file:|[A-Za-z]:[\\/])/;

// Keyed by entry file + entry source hash; each entry additionally records the
// bundled dependency contents it was built from and is only served while those
// still match (see findCachedModuleWithFreshDeps).
const transpileCache = new Map<string, TranspileCacheEntry[]>();
const adapterCacheIds = new WeakMap<FileSystemAdapter, number>();
let nextAdapterCacheId = 1;

const textEncoder = new TextEncoder();

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function assertSourceWithinLimit(source: string): void {
  if (utf8ByteLength(source) > MAX_DISCOVERY_SOURCE_BYTES) {
    throw COMPILATION_ERROR.create({
      detail: "Discovery module source exceeds the size limit",
    });
  }
}

function assertSourceFileSizeWithinLimit(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_DISCOVERY_SOURCE_BYTES) {
    throw COMPILATION_ERROR.create({
      detail: "Discovery module source exceeds the size limit",
    });
  }
}

function getAdapterCacheId(adapter: FileSystemAdapter): number {
  const existing = adapterCacheIds.get(adapter);
  if (existing !== undefined) return existing;
  if (!Number.isSafeInteger(nextAdapterCacheId)) {
    throw new RangeError("Discovery adapter cache identity space exhausted");
  }
  const id = nextAdapterCacheId++;
  adapterCacheIds.set(adapter, id);
  return id;
}

function getTranspileCacheKey(
  file: string,
  sourceHash: string,
  context: FileDiscoveryContext,
  reuseInitializedModule: boolean,
): string | null {
  if (!reuseInitializedModule) return null;
  // A hosted multi-project adapter resolves relative paths through request
  // context. The same adapter and logical path can therefore identify
  // different tenants, so initialized modules must never be reused there.
  if (context.fsAdapter && !context.baseDir) return null;
  const adapterId = context.fsAdapter ? getAdapterCacheId(context.fsAdapter) : 0;
  return `${adapterId}\0${context.baseDir ?? ""}\0${file}\0${sourceHash}`;
}

function getCachedEntries(key: string): TranspileCacheEntry[] | undefined {
  const entries = transpileCache.get(key);
  if (!entries) return undefined;
  transpileCache.delete(key);
  transpileCache.set(key, entries);
  return entries;
}

function cacheTranspiledModule(key: string, entry: TranspileCacheEntry): void {
  const entries = transpileCache.get(key) ?? [];
  entries.push(entry);
  if (entries.length > MAX_DEPENDENCY_VARIANTS_PER_MODULE) entries.shift();
  transpileCache.delete(key);
  transpileCache.set(key, entries);

  while (transpileCache.size > MAX_TRANSPILE_CACHE_ENTRIES) {
    const oldestKey = transpileCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    transpileCache.delete(oldestKey);
  }
}

async function hashSource(source: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(source),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Returns the first cached module whose recorded bundled-dependency contents
 * still match what the current adapter serves. esbuild inlines relative
 * imports into the bundle, so an unchanged entry file does not guarantee an
 * unchanged module: a dependency edited by a new release (or differing between
 * two projects that share the same entry source) must invalidate the entry.
 */
async function findCachedModuleWithFreshDeps(
  entries: readonly TranspileCacheEntry[],
  context: FileDiscoveryContext,
): Promise<unknown | undefined> {
  const hashByPath = new Map<string, string | undefined>();
  for (const entry of entries) {
    let depsMatch = true;
    for (const dep of entry.deps) {
      let hash = hashByPath.get(dep.path);
      if (!hashByPath.has(dep.path)) {
        try {
          let content: string;
          if (context.fsAdapter) {
            assertSourceFileSizeWithinLimit((await context.fsAdapter.stat(dep.path)).size);
            content = await context.fsAdapter.readFile(dep.path);
          } else {
            const fs = createFileSystem();
            assertSourceFileSizeWithinLimit((await fs.stat(dep.path)).size);
            content = await fs.readTextFile(dep.path);
          }
          assertSourceWithinLimit(content);
          hash = await hashSource(content);
        } catch {
          hash = undefined;
        }
        hashByPath.set(dep.path, hash);
      }
      if (hash === undefined || hash !== dep.hash) {
        depsMatch = false;
        break;
      }
    }
    if (depsMatch) return entry.module;
  }
  return undefined;
}

// Setup veryfront modules as globals for compiled binary support
let veryfrontGlobalsInitialized = false;

/**
 * Ensure veryfront modules are available as globals for compiled binaries
 */
async function ensureVeryfrontGlobals(): Promise<void> {
  if (veryfrontGlobalsInitialized || !isDenoCompiled) return;

  installDiscoveryRuntimeModulesGlobal();

  veryfrontGlobalsInitialized = true;
}

/**
 * Create an esbuild plugin for resolving files via fsAdapter
 */
function createFsAdapterPlugin(
  fsAdapter: FileSystemAdapter,
  context: FileDiscoveryContext,
  onDependencyLoaded?: (path: string, content: string) => void,
): Plugin {
  const existsCache = new Map<string, boolean>();

  function resolveAdapterImportPath(importerDir: string, importPath: string): string {
    if (context.baseDir !== "") {
      return pathHelper.isAbsolute(importPath)
        ? importPath
        : pathHelper.resolve(importerDir, importPath);
    }

    if (pathHelper.isAbsolute(importPath)) return importPath;
    const processRoot = pathHelper.resolve(".");
    let virtualImporterDir = importerDir;
    if (pathHelper.isAbsolute(importerDir)) {
      const relativeImporter = pathHelper.relative(processRoot, importerDir);
      if (
        relativeImporter !== ".." && !relativeImporter.startsWith(`..${pathHelper.SEPARATOR}`) &&
        !pathHelper.isAbsolute(relativeImporter)
      ) {
        virtualImporterDir = relativeImporter;
      }
    }
    return pathHelper.normalize(pathHelper.join(virtualImporterDir, importPath));
  }

  async function checkExists(filePath: string): Promise<boolean> {
    const cached = existsCache.get(filePath);
    if (cached !== undefined) return cached;
    if (existsCache.size >= MAX_DISCOVERY_RESOLUTION_ATTEMPTS) {
      throw COMPILATION_ERROR.create({
        detail: "Discovery module resolution limit exceeded",
      });
    }

    assertDiscoveryPathLexicallyWithinBase(filePath, context);
    const exists = await fsAdapter.exists(filePath);
    existsCache.set(filePath, exists);
    return exists;
  }

  async function resolveWithExtensions(basePath: string): Promise<string | null> {
    assertDiscoveryPathLexicallyWithinBase(basePath, context);
    if (/\.(ts|tsx|js|jsx|mjs|json)$/i.test(basePath)) {
      if (!(await checkExists(basePath))) return null;
      await assertDiscoveryPathWithinBase(basePath, context);
      return basePath;
    }

    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

    for (const ext of extensions) {
      const fullPath = basePath + ext;
      if (await checkExists(fullPath)) {
        await assertDiscoveryPathWithinBase(fullPath, context);
        return fullPath;
      }
    }

    for (const ext of extensions) {
      const indexPath = pathHelper.join(basePath, `index${ext}`);
      if (await checkExists(indexPath)) {
        await assertDiscoveryPathWithinBase(indexPath, context);
        return indexPath;
      }
    }

    return null;
  }

  return {
    name: "veryfront-fsadapter",
    setup(build: PluginBuild) {
      // Wrap callbacks with wrapWithCurrentContext to preserve the
      // MultiProjectFSAdapter AsyncLocalStorage context across esbuild's
      // child-process message boundary. Without this, fsAdapter.exists()
      // and fsAdapter.readFile() cannot resolve the per-project adapter.
      build.onResolve(
        { filter: FILESYSTEM_IMPORT_PATTERN },
        wrapWithCurrentContext(async (args) => {
          const importerDir = args.importer ? pathHelper.dirname(args.importer) : args.resolveDir;
          const importPath = args.path.startsWith("file:")
            ? pathHelper.fromFileUrl(args.path)
            : args.path;
          const basePath = resolveAdapterImportPath(importerDir, importPath);

          const resolvedPath = await resolveWithExtensions(basePath);
          if (resolvedPath) return { path: resolvedPath, namespace: "fsadapter" };

          return {
            errors: [
              {
                text: "Discovery dependency could not be resolved",
              },
            ],
          };
        }),
      );

      build.onLoad(
        { filter: /.*/, namespace: "fsadapter" },
        wrapWithCurrentContext(async (args) => {
          try {
            await assertDiscoveryPathWithinBase(args.path, context);
            assertSourceFileSizeWithinLimit((await fsAdapter.stat(args.path)).size);
            const content = await fsAdapter.readFile(args.path);
            assertSourceWithinLimit(content);
            onDependencyLoaded?.(args.path, content);
            return {
              contents: content,
              loader: getEsbuildLoader(args.path),
              resolveDir: pathHelper.dirname(args.path),
            };
          } catch {
            return {
              errors: [
                {
                  text: "Discovery dependency could not be loaded",
                },
              ],
            };
          }
        }),
      );
    },
  };
}

/**
 * Resolve and load local relative dependencies through the same project-root
 * boundary as adapter-backed discovery. Loading through the plugin also lets
 * the transpile cache record local dependencies instead of treating an entry
 * source hash as sufficient freshness evidence.
 */
function createLocalFileSystemPlugin(
  context: FileDiscoveryContext,
  onDependencyLoaded?: (path: string, content: string) => void,
): Plugin {
  const fs = createFileSystem();
  let resolutionAttempts = 0;

  async function resolveWithExtensions(basePath: string): Promise<string | null> {
    const candidates = /\.(?:ts|tsx|js|jsx|mjs|json)$/i.test(basePath) ? [basePath] : [
      ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"].map((extension) => basePath + extension),
      ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"].map((extension) =>
        pathHelper.join(basePath, `index${extension}`)
      ),
    ];

    for (const candidate of candidates) {
      resolutionAttempts++;
      if (resolutionAttempts > MAX_DISCOVERY_RESOLUTION_ATTEMPTS) {
        throw COMPILATION_ERROR.create({
          detail: "Discovery module resolution limit exceeded",
        });
      }
      assertDiscoveryPathLexicallyWithinBase(candidate, context);
      if (!(await fs.exists(candidate))) continue;
      await assertDiscoveryPathWithinBase(candidate, context);
      return candidate;
    }
    return null;
  }

  return {
    name: "veryfront-local-discovery",
    setup(build: PluginBuild) {
      build.onResolve({ filter: FILESYSTEM_IMPORT_PATTERN }, async (args) => {
        const importerDir = args.importer ? pathHelper.dirname(args.importer) : args.resolveDir;
        const importPath = args.path.startsWith("file:")
          ? pathHelper.fromFileUrl(args.path)
          : args.path;
        const basePath = pathHelper.isAbsolute(importPath)
          ? importPath
          : pathHelper.resolve(importerDir, importPath);
        const resolved = await resolveWithExtensions(basePath);
        return resolved ? { path: resolved } : null;
      });

      build.onLoad(
        { filter: /\.(?:ts|tsx|js|jsx|mjs|json)$/i, namespace: "file" },
        async (args) => {
          try {
            await assertDiscoveryPathWithinBase(args.path, context);
            assertSourceFileSizeWithinLimit((await fs.stat(args.path)).size);
            const content = await fs.readTextFile(args.path);
            assertSourceWithinLimit(content);
            onDependencyLoaded?.(args.path, content);
            return {
              contents: content,
              loader: getEsbuildLoader(args.path),
              resolveDir: pathHelper.dirname(args.path),
            };
          } catch {
            return { errors: [{ text: "Discovery dependency could not be loaded" }] };
          }
        },
      );
    },
  };
}

/**
 * Import and transpile a module for discovery
 */
export async function importModule(
  file: string,
  context: FileDiscoveryContext,
  options: DiscoveryModuleImportOptions = {},
): Promise<unknown> {
  // Ensure veryfront modules are available as globals for compiled binaries
  await ensureVeryfrontGlobals();

  const filePath = discoveryFileUrlToPath(file, context);
  await assertDiscoveryPathWithinBase(filePath, context);

  let sourceFileSize: number;
  try {
    sourceFileSize = context.fsAdapter
      ? (await context.fsAdapter.stat(filePath)).size
      : (await createFileSystem().stat(filePath)).size;
  } catch {
    throw FILE_NOT_FOUND.create({
      detail: "Failed to read file for discovery",
    });
  }
  assertSourceFileSizeWithinLimit(sourceFileSize);

  let source: string;
  try {
    source = context.fsAdapter
      ? await context.fsAdapter.readFile(filePath)
      : await createFileSystem().readTextFile(filePath);
  } catch {
    throw FILE_NOT_FOUND.create({
      detail: "Failed to read file for discovery",
    });
  }
  assertSourceWithinLimit(source);

  // The cache key must include the source content: a shared hosted runtime
  // process serves many projects and releases, and the same relative path
  // (e.g. "tools/foo.ts") recurs across them. A path-only key keeps serving
  // the stale module after a deploy and can hand one project's module to
  // another project's discovery. The entry hash alone is still not enough.
  // Bundled relative imports are inlined into the module, so cached entries
  // are only served after their recorded dependency contents re-verify.
  const cacheKey = getTranspileCacheKey(
    file,
    await hashSource(source),
    context,
    options.reuseInitializedModule ?? true,
  );
  const cachedEntries = cacheKey ? getCachedEntries(cacheKey) : undefined;
  if (cachedEntries !== undefined) {
    const cached = await findCachedModuleWithFreshDeps(cachedEntries, context);
    if (cached !== undefined) return cached;
  }

  const loader = getEsbuildLoader(filePath);
  await ensureDefaultBundlerContracts();
  const { build } = await import("veryfront/extensions/bundler");
  const fileDir = pathHelper.dirname(filePath);

  const hasFsAdapter = !!context.fsAdapter;

  // Record every bundled dependency for cache re-validation. Entry source
  // hashing alone cannot detect a changed relative import.
  const bundledDeps: Array<{ path: string; content: string }> = [];
  let bundledDependencyBytes = 0;
  const recordDependency = (path: string, content: string): void => {
    if (bundledDeps.length >= MAX_DISCOVERY_DEPENDENCIES) {
      throw COMPILATION_ERROR.create({
        detail: "Discovery module dependency limit exceeded",
      });
    }
    bundledDependencyBytes += utf8ByteLength(content);
    if (bundledDependencyBytes > MAX_DISCOVERY_DEPENDENCY_BYTES) {
      throw COMPILATION_ERROR.create({
        detail: "Discovery module dependencies exceed the size limit",
      });
    }
    bundledDeps.push({ path, content });
  };
  const plugins = hasFsAdapter
    ? [createFsAdapterPlugin(context.fsAdapter!, context, recordDependency)]
    : [createLocalFileSystemPlugin(context, recordDependency)];

  const result = await (async () => {
    try {
      return await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        target: "es2022",
        logLevel: "silent",
        jsx: "automatic",
        jsxImportSource: "react",
        resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
        plugins,
        // Externalize all bare-specifier imports so npm packages a tool/agent file
        // depends on (e.g. `pdf-parse`, `mammoth`) are not pulled into the
        // discovery bundle. Discovery only needs the module's exports; the
        // implementation runs server-side at request time and can resolve npm
        // packages natively via the project's node_modules / import map.
        // Without this, esbuild under platform: "neutral" tries to bundle CJS
        // npm packages and fails on their Node built-in references (fs, http, ...).
        packages: "external",
        external: [
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
          resolveDir: fileDir,
          // Must be a basename: esbuild joins resolveDir + sourcefile to form the
          // entry module path when sourcefile is relative. Passing the full
          // relative filePath (e.g. "tools/foo.ts") on VFS runs (baseDir === "")
          // doubles the prefix to "tools/tools/foo.ts", which anchors ../ imports
          // one directory too deep.
          sourcefile: pathHelper.basename(filePath),
        },
      });
    } catch {
      throw COMPILATION_ERROR.create({
        detail: "Discovery module compilation failed",
      });
    }
  })();

  if (result.errors.length > 0) {
    throw COMPILATION_ERROR.create({
      detail: "Discovery module compilation failed",
    });
  }

  const js = result.outputFiles?.[0]?.text;
  if (typeof js !== "string" || js.length === 0) {
    throw COMPILATION_ERROR.create({
      detail: "Discovery module compiler produced no output",
    });
  }
  if (utf8ByteLength(js) > MAX_DISCOVERY_BUNDLE_BYTES) {
    throw COMPILATION_ERROR.create({
      detail: "Discovery module output exceeds the size limit",
    });
  }

  const localFs = createFileSystem();
  const tempDir = await localFs.makeTempDir({ prefix: "vf-discovery-" });
  const tempFile = pathHelper.join(tempDir, "module.mjs");

  let module: unknown;
  let deps: Array<{ path: string; hash: string }> = [];
  let primaryError: unknown;
  try {
    let transformedCode: string;
    try {
      transformedCode = isDeno
        ? await rewriteForDeno(js, fileDir)
        : await rewriteDiscoveryImports(js, context.baseDir ?? ".", localFs, fileDir);
      await localFs.writeTextFile(tempFile, transformedCode);
    } catch {
      throw COMPILATION_ERROR.create({
        detail: "Discovery module imports could not be prepared",
      });
    }

    const moduleUrl = pathHelper.toFileUrl(tempFile);
    moduleUrl.searchParams.set("v", String(Date.now()));
    try {
      const initialize = () => runWithSharedRegistryMutationsDisabled(() => import(moduleUrl.href));
      module = await initialize();
    } catch {
      throw COMPILATION_ERROR.create({
        detail: "Discovery module initialization failed",
      });
    }
    deps = await Promise.all(
      bundledDeps.map(async ({ path, content }) => ({ path, hash: await hashSource(content) })),
    );
  } catch (error) {
    primaryError = error;
  }

  let cleanupFailed = false;
  try {
    await localFs.remove(tempDir, { recursive: true });
  } catch {
    cleanupFailed = true;
  }
  if (primaryError !== undefined) throw primaryError;
  if (cleanupFailed) {
    throw COMPILATION_ERROR.create({
      detail: "Discovery temporary module cleanup failed",
    });
  }

  if (cacheKey) cacheTranspiledModule(cacheKey, { deps, module });
  return module;
}

/**
 * Clear the transpile cache
 */
export function clearTranspileCache(): void {
  transpileCache.clear();
  // Adapter identities remain monotonic. Resetting them can collide with a
  // key computed by an in-flight import while another request clears cache.
}
