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
  /**
   * File-existence decisions that selected each relative import target.
   *
   * Negative probes matter: adding `config.ts` must invalidate a cached bundle
   * that previously resolved the same extensionless import to `config.tsx`.
   */
  resolutionProbes: ReadonlyArray<{ path: string; exists: boolean }>;
  module: unknown;
};

interface FsAdapterPluginObservers {
  onDependencyLoaded?(path: string, content: string): void;
  onResolutionProbed?(path: string, exists: boolean): void;
}

const DISCOVERY_RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"] as const;

// Keyed by entry file + entry source hash; each entry additionally records the
// bundled dependency contents it was built from and is only served while those
// and the resolver decisions that selected them still match.
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
 * Returns the first cached module whose recorded resolution decisions and
 * bundled-dependency contents still match the current filesystem. esbuild
 * inlines relative imports into the bundle, so an unchanged entry file does
 * not guarantee an unchanged module: a dependency edit or a newly available
 * higher-priority extension candidate must invalidate the entry.
 */
async function findCachedModuleWithFreshInputs(
  entries: readonly TranspileCacheEntry[],
  context: FileDiscoveryContext,
): Promise<unknown | undefined> {
  const hashByPath = new Map<string, string | undefined>();
  const existenceByPath = new Map<string, boolean | undefined>();
  const resolutionFs = context.fsAdapter ?? createFileSystem();

  for (const entry of entries) {
    let inputsMatch = true;
    for (const probe of entry.resolutionProbes) {
      let exists = existenceByPath.get(probe.path);
      if (!existenceByPath.has(probe.path)) {
        try {
          exists = await resolutionFs.exists(probe.path);
        } catch {
          exists = undefined;
        }
        existenceByPath.set(probe.path, exists);
      }
      if (exists === undefined || exists !== probe.exists) {
        inputsMatch = false;
        break;
      }
    }
    if (!inputsMatch) continue;

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
        inputsMatch = false;
        break;
      }
    }
    if (inputsMatch) return entry.module;
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
function relativeResolutionCandidates(basePath: string): readonly string[] {
  if (/\.(ts|tsx|js|jsx|mjs|json)$/i.test(basePath)) return [basePath];
  return [
    ...DISCOVERY_RESOLVE_EXTENSIONS.map((extension) => basePath + extension),
    ...DISCOVERY_RESOLVE_EXTENSIONS.map((extension) =>
      pathHelper.join(basePath, `index${extension}`)
    ),
  ];
}

function createFsAdapterPlugin(
  fsAdapter: FileSystemAdapter,
  observers: FsAdapterPluginObservers = {},
): Plugin {
  const existsCache = new Map<string, boolean>();

  async function checkExists(filePath: string): Promise<boolean> {
    const cached = existsCache.get(filePath);
    if (cached !== undefined) return cached;

    const exists = await fsAdapter.exists(filePath);
    existsCache.set(filePath, exists);
    observers.onResolutionProbed?.(filePath, exists);
    return exists;
  }

  async function resolveWithExtensions(basePath: string): Promise<string | null> {
    for (const candidate of relativeResolutionCandidates(basePath)) {
      if (await checkExists(candidate)) return candidate;
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
            observers.onDependencyLoaded?.(args.path, content);
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
 * Observe native relative-import resolution without replacing the bundler's
 * resolver. The configured candidate order matches `resolveExtensions` below;
 * every negative decision before the selected path becomes cache evidence.
 */
function createNativeResolutionProbePlugin(
  fs: ReturnType<typeof createFileSystem>,
  onResolutionProbed: (path: string, exists: boolean) => void,
): Plugin {
  return {
    name: "veryfront-native-resolution-probes",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^\.\.?\// }, async (args) => {
        const importerDir = args.importer ? pathHelper.dirname(args.importer) : args.resolveDir;
        const basePath = pathHelper.resolve(importerDir, args.path);
        for (const candidate of relativeResolutionCandidates(basePath)) {
          const exists = await fs.exists(candidate);
          onResolutionProbed(candidate, exists);
          if (exists) break;
        }
        return undefined;
      });
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

  // A shared hosted runtime serves many registry scopes, projects, adapters,
  // and source generations. Every one participates in the cache identity so
  // identical relative paths cannot share request-bound module state across
  // tenants or previews. Entry content alone is insufficient because bundled
  // relative imports are inlined; recorded dependency contents are rechecked
  // before a cached module is reused.
  const scopeId = tryGetRegistryScopeId() ?? "__default__";
  const adapterIdentity = getFsAdapterIdentity(context);
  const cacheNamespace = context.cacheNamespace ?? context.baseDir ?? "";
  const cacheKey = JSON.stringify([
    scopeId,
    cacheNamespace,
    adapterIdentity,
    file,
    await computeHash(source),
  ]);
  const generation = transpileCacheGeneration;
  const cachedEntries = transpileCache.get(cacheKey);
  if (cachedEntries) {
    const cached = await findCachedModuleWithFreshInputs(cachedEntries, context);
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

    const fsAdapter = context.fsAdapter;
    const hasFsAdapter = fsAdapter !== undefined;
    const localFs = createFileSystem();

    // Record every bundled dependency for cache re-validation. Adapter loads
    // report their contents through the plugin; native inputs are collected
    // from the bundler metafile below.
    const bundledDepContents = new Map<string, string>();
    const resolutionProbeOutcomes = new Map<string, boolean>();
    const recordResolutionProbe = (path: string, exists: boolean): void => {
      resolutionProbeOutcomes.set(path, exists);
    };
    const plugins = fsAdapter
      ? [
        createFsAdapterPlugin(fsAdapter, {
          onDependencyLoaded: (path, content) => {
            bundledDepContents.set(path, content);
          },
          onResolutionProbed: recordResolutionProbe,
        }),
      ]
      : [createNativeResolutionProbePlugin(localFs, recordResolutionProbe)];

    const result = await build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      jsx: "automatic",
      jsxImportSource: "react",
      resolveExtensions: [...DISCOVERY_RESOLVE_EXTENSIONS],
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
      const resolutionProbes = Array.from(
        resolutionProbeOutcomes,
        ([path, exists]) => ({ path, exists }),
      );
      // A native bundler that ignores `metafile: true` gives us no dependency
      // graph to revalidate. Serving that result from cache would make edits
      // to relative imports invisible, so such results remain deliberately
      // uncached. Adapter builds track dependencies through the load plugin.
      const cacheable = hasFsAdapter || result.metafile !== undefined;
      if (cacheable && generation === transpileCacheGeneration) {
        cacheTranspiledModule(cacheKey, { deps, resolutionProbes, module });
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
