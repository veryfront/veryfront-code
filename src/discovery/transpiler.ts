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
import { computeHash } from "#veryfront/utils";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import type { FileDiscoveryContext } from "./types.ts";
import {
  clearDiscoveryImportRewriteCache,
  rewriteDiscoveryImports,
  rewriteForDeno,
} from "./import-rewriter.ts";
import { COMPILATION_ERROR, FILE_NOT_FOUND } from "#veryfront/errors";
import { wrapWithCurrentContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { getDiscoveryRuntimeModules } from "./runtime-modules.ts";
import { tryGetRegistryScopeId } from "#veryfront/cache/cache-key-builder.ts";

type TranspileCacheEntry = {
  /** Content hashes of every file the bundler reports for the module. */
  deps: ReadonlyArray<{ path: string; hash: string }>;
  module: unknown;
};

// Keyed by entry file + entry source hash; each entry additionally records the
// bundled dependency contents it was built from and is only served while those
// still match (see findCachedModuleWithFreshDeps).
const transpileCache = new Map<string, TranspileCacheEntry[]>();
const inFlightImports = new Map<string, Promise<unknown>>();
const fsAdapterIds = new WeakMap<FileSystemAdapter, number>();
const MAX_TRANSPILE_CACHE_KEYS = 256;
const MAX_TRANSPILE_CACHE_VERSIONS_PER_KEY = 8;
let nextFsAdapterId = 1;
let transpileCacheGeneration = 0;
let nextModuleImportId = 1;

function getFsAdapterIdentity(context: FileDiscoveryContext): string {
  const adapter = context.fsAdapter;
  if (!adapter) return "native";
  let id = fsAdapterIds.get(adapter);
  if (id === undefined) {
    id = nextFsAdapterId++;
    fsAdapterIds.set(adapter, id);
  }
  return `adapter:${id}`;
}

function touchTranspileCacheKey(key: string, entries: TranspileCacheEntry[]): void {
  transpileCache.delete(key);
  transpileCache.set(key, entries);
}

function cacheTranspiledModule(key: string, entry: TranspileCacheEntry): void {
  const entries = transpileCache.get(key) ?? [];
  entries.unshift(entry);
  if (entries.length > MAX_TRANSPILE_CACHE_VERSIONS_PER_KEY) {
    entries.length = MAX_TRANSPILE_CACHE_VERSIONS_PER_KEY;
  }
  touchTranspileCacheKey(key, entries);

  while (transpileCache.size > MAX_TRANSPILE_CACHE_KEYS) {
    const oldestKey = transpileCache.keys().next().value;
    if (oldestKey === undefined) break;
    transpileCache.delete(oldestKey);
  }
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
          const content = context.fsAdapter
            ? await context.fsAdapter.readFile(dep.path)
            : await createFileSystem().readTextFile(dep.path);
          hash = await computeHash(content);
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

  (globalThis as Record<string, unknown>).__VERYFRONT_MODULES__ = getDiscoveryRuntimeModules();

  veryfrontGlobalsInitialized = true;
}

/**
 * Create an esbuild plugin for resolving files via fsAdapter
 */
function createFsAdapterPlugin(
  fsAdapter: FileSystemAdapter,
  onDependencyLoaded?: (path: string, content: string) => void,
): Plugin {
  const existsCache = new Map<string, boolean>();

  async function checkExists(filePath: string): Promise<boolean> {
    const cached = existsCache.get(filePath);
    if (cached !== undefined) return cached;

    const exists = await fsAdapter.exists(filePath);
    existsCache.set(filePath, exists);
    return exists;
  }

  async function resolveWithExtensions(basePath: string): Promise<string | null> {
    if (/\.(ts|tsx|js|jsx|mjs|json)$/i.test(basePath)) {
      return (await checkExists(basePath)) ? basePath : null;
    }

    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

    for (const ext of extensions) {
      const fullPath = basePath + ext;
      if (await checkExists(fullPath)) return fullPath;
    }

    for (const ext of extensions) {
      const indexPath = pathHelper.join(basePath, `index${ext}`);
      if (await checkExists(indexPath)) return indexPath;
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
        { filter: /^\.\.?\// },
        wrapWithCurrentContext(async (args) => {
          const importerDir = args.importer ? pathHelper.dirname(args.importer) : args.resolveDir;
          const basePath = pathHelper.resolve(importerDir, args.path);

          const resolvedPath = await resolveWithExtensions(basePath);
          if (resolvedPath) return { path: resolvedPath, namespace: "fsadapter" };

          return {
            errors: [
              {
                text: `Could not resolve "${args.path}" from "${importerDir}" via fsAdapter`,
              },
            ],
          };
        }),
      );

      build.onLoad(
        { filter: /.*/, namespace: "fsadapter" },
        wrapWithCurrentContext(async (args) => {
          try {
            const content = await fsAdapter.readFile(args.path);
            onDependencyLoaded?.(args.path, content);
            return {
              contents: content,
              loader: getEsbuildLoader(args.path),
              resolveDir: pathHelper.dirname(args.path),
            };
          } catch (error) {
            return {
              errors: [
                {
                  text: `Failed to load "${args.path}" from fsAdapter: ${error}`,
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
 * Import and transpile a module for discovery
 */
export async function importModule(
  file: string,
  context: FileDiscoveryContext,
): Promise<unknown> {
  // Ensure veryfront modules are available as globals for compiled binaries
  await ensureVeryfrontGlobals();

  const filePath = file.startsWith("file://")
    ? context.fsAdapter && !file.startsWith("file:///")
      ? decodeURIComponent(file.slice("file://".length))
      : pathHelper.fromFileUrl(file)
    : file;

  let source: string;
  try {
    source = context.fsAdapter
      ? await context.fsAdapter.readFile(filePath)
      : await createFileSystem().readTextFile(filePath);
  } catch (error) {
    throw FILE_NOT_FOUND.create({
      detail: `Failed to read file ${filePath}: ${error}`,
      cause: error,
    });
  }

  // The cache key must include the source content: a shared hosted runtime
  // process serves many projects and releases, and the same relative path
  // (e.g. "tools/foo.ts") recurs across them. A path-only key keeps serving
  // the stale module after a deploy and can hand one project's module to
  // another project's discovery. The entry hash alone is still not enough —
  // bundled relative imports are inlined into the module — so cached entries
  // are only served after their recorded dependency contents re-verify.
  const scopeId = tryGetRegistryScopeId() ?? "__default__";
  const adapterIdentity = getFsAdapterIdentity(context);
  const cacheKey = `${scopeId}\0${adapterIdentity}\0${file}\0${await computeHash(source)}`;
  const generation = transpileCacheGeneration;
  const cachedEntries = transpileCache.get(cacheKey);
  if (cachedEntries) {
    const cached = await findCachedModuleWithFreshDeps(cachedEntries, context);
    // A clear that happens while dependency contents are being read marks a
    // generation boundary. Restart so the caller cannot resurrect or consume
    // the just-invalidated module.
    if (generation !== transpileCacheGeneration) {
      return await importModule(file, context);
    }
    if (cached) {
      touchTranspileCacheKey(cacheKey, cachedEntries);
      return cached;
    }
  }

  const inFlightKey = `${generation}\0${cacheKey}`;
  const existingImport = inFlightImports.get(inFlightKey);
  if (existingImport) return await existingImport;

  const pendingImport = (async (): Promise<unknown> => {
    const loader = getEsbuildLoader(filePath);
    await ensureDefaultBundlerContracts();
    const { build } = await import("veryfront/extensions/bundler");
    const fileDir = pathHelper.dirname(filePath);

    const hasFsAdapter = !!context.fsAdapter;

    // Record every bundled dependency for cache re-validation. Adapter loads
    // report their contents through the plugin; native inputs are collected
    // from the bundler metafile below.
    const bundledDepContents = new Map<string, string>();
    const plugins = hasFsAdapter
      ? [
        createFsAdapterPlugin(context.fsAdapter!, (path, content) => {
          bundledDepContents.set(path, content);
        }),
      ]
      : [];

    const result = await build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      jsx: "automatic",
      jsxImportSource: "react",
      resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
      plugins,
      metafile: true,
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

    if (result.errors.length > 0) {
      throw COMPILATION_ERROR.create({
        detail: `Failed to transpile ${filePath}: ${result.errors[0]?.text ?? "unknown error"}`,
      });
    }

    const localFs = createFileSystem();
    if (!hasFsAdapter) {
      for (const inputPath of Object.keys(result.metafile?.inputs ?? {})) {
        const resolvedPath = pathHelper.isAbsolute(inputPath)
          ? inputPath
          : pathHelper.resolve(inputPath);
        const content = pathHelper.resolve(resolvedPath) === pathHelper.resolve(filePath)
          ? source
          : await localFs.readTextFile(resolvedPath);
        bundledDepContents.set(resolvedPath, content);
      }
    }

    const output = result.outputFiles[0];
    if (!output) {
      throw COMPILATION_ERROR.create({
        detail: `Bundler produced no JavaScript output for ${filePath}`,
      });
    }
    const js = output.text;

    const tempDir = await localFs.makeTempDir({ prefix: "vf-discovery-" });
    try {
      const tempFile = pathHelper.join(tempDir, "module.mjs");
      const transformedCode = isDeno
        ? rewriteForDeno(js, fileDir)
        : await rewriteDiscoveryImports(js, context.baseDir ?? ".", localFs, fileDir);
      await localFs.writeTextFile(tempFile, transformedCode);

      const moduleUrl = pathHelper.toFileUrl(tempFile);
      moduleUrl.searchParams.set("v", String(nextModuleImportId++));
      const module = await import(moduleUrl.href);
      const deps = await Promise.all(
        Array.from(bundledDepContents, async ([path, content]) => ({
          path,
          hash: await computeHash(content),
        })),
      );
      // A native bundler that ignores `metafile: true` gives us no dependency
      // graph to revalidate. Serving that result from cache would make edits
      // to relative imports invisible, so such results remain deliberately
      // uncached. Adapter builds track dependencies through the load plugin.
      const cacheable = hasFsAdapter || result.metafile !== undefined;
      if (cacheable && generation === transpileCacheGeneration) {
        cacheTranspiledModule(cacheKey, { deps, module });
      }
      return module;
    } finally {
      await localFs.remove(tempDir, { recursive: true });
    }
  })();

  inFlightImports.set(inFlightKey, pendingImport);
  try {
    return await pendingImport;
  } finally {
    if (inFlightImports.get(inFlightKey) === pendingImport) {
      inFlightImports.delete(inFlightKey);
    }
  }
}

/**
 * Clear the transpile cache
 */
export function clearTranspileCache(): void {
  transpileCacheGeneration++;
  transpileCache.clear();
  inFlightImports.clear();
  clearDiscoveryImportRewriteCache();
}
