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
import { rewriteDiscoveryImports, rewriteForDeno } from "./import-rewriter.ts";
import { splitPackageSubpath } from "#veryfront/transforms/import-rewriter/package-resolution.ts";
import { createHTTPPlugin } from "#veryfront/transforms/esm/http-bundler.ts";
import { ESM_CDN_BASE } from "#veryfront/utils/constants/cdn.ts";
import { guardedOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { COMPILATION_ERROR, DEPENDENCY_MISSING, FILE_NOT_FOUND } from "#veryfront/errors";
import { wrapWithCurrentContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { getDiscoveryRuntimeModules } from "./runtime-modules.ts";
import { isExplicitHostProjectCodeExecutionAllowed } from "#veryfront/security/project-locality.ts";

type TranspileCacheEntry = {
  /** Content hashes of every file esbuild bundled into the module besides the entry. */
  deps: ReadonlyArray<{ path: string; hash: string }>;
  module: unknown;
};

// Keyed by entry file + entry source hash; each entry additionally records the
// bundled dependency contents it was built from and is only served while those
// still match (see findCachedModuleWithFreshDeps).
const transpileCache = new Map<string, TranspileCacheEntry[]>();

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
 * A project dependency pin is only usable as a CDN coordinate when it names an
 * exact version. Ranges, aliases (`workspace:`, `file:`, `npm:`) and `*` would
 * have to be resolved against a registry, and resolving them to `latest` would
 * silently change which code a project runs between two discovery passes.
 */
function toExactVersion(range: unknown): string | null {
  if (typeof range !== "string") return null;
  const trimmed = range.trim().replace(/^[v=]/, "");
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/.test(trimmed) ? trimmed : null;
}

/**
 * Exact-version dependency pins declared by a project's package.json.
 *
 * @internal Exported for testing only.
 */
export function readDependencyPins(packageJsonText: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch (_) {
    /* expected: a project may ship an unparseable or absent package.json */
    return {};
  }

  const pkg = parsed as { dependencies?: unknown; devDependencies?: unknown };
  const pins: Record<string, string> = {};
  for (const group of [pkg?.dependencies, pkg?.devDependencies]) {
    if (!group || typeof group !== "object") continue;
    for (const [name, range] of Object.entries(group as Record<string, unknown>)) {
      const version = toExactVersion(range);
      if (version) pins[name] = version;
    }
  }
  return pins;
}

async function readProjectDependencyPins(
  context: FileDiscoveryContext,
): Promise<Record<string, string>> {
  const packageJsonPath = pathHelper.join(context.baseDir ?? ".", "package.json");
  try {
    const text = context.fsAdapter
      ? await context.fsAdapter.readFile(packageJsonPath)
      : await createFileSystem().readTextFile(packageJsonPath);
    return readDependencyPins(text);
  } catch (_) {
    /* expected: a project without a package.json declares no dependencies */
    return {};
  }
}

/**
 * The `<pkg>@<version>` a compiled binary refused to resolve, or `null` when
 * the failure is unrelated. Deno answers an `npm:` specifier that is not in a
 * compiled binary's frozen package set with
 * `Could not find constraint 'unpdf@1.8.1' in the list of packages.`
 *
 * @internal Exported for testing only.
 */
export function describeUnresolvableNpmImport(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const constraint = /Could not find constraint '([^']+)'/.exec(message);
  if (constraint?.[1]) return constraint[1];
  const resolution = /Could not resolve ["']npm:([^"']+)["']/.exec(message);
  if (resolution?.[1]) return resolution[1];
  const missing = /npm package '([^']+)' does not exist/.exec(message);
  return missing?.[1] ?? null;
}

const ESM_CDN_ORIGIN = new URL(ESM_CDN_BASE).origin;

/**
 * Specifiers the framework itself hands to discovered modules. Serving these
 * from a CDN would bind a discovered tool to a second copy of the framework,
 * of React, or of the schema library whose instance the registries compare
 * against, so a project pin never redirects them.
 */
const FRAMEWORK_PROVIDED_PACKAGES = new Set(["veryfront", "react", "react-dom", "zod", "path"]);

function isFrameworkProvidedPackage(name: string): boolean {
  return FRAMEWORK_PROVIDED_PACKAGES.has(name) ||
    name.startsWith("veryfront/") ||
    name.startsWith("@opentelemetry/") ||
    name.startsWith("node:");
}

/**
 * Project dependency sources are fetched through the host egress ceiling and
 * only from the pinned ESM CDN: a project supplies the package name and the
 * version it declared, never the host.
 */
function fetchProjectDependencySource(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return guardedOutboundFetch(input, init, {
    authorizeUrl: (url) => {
      if (url.origin !== ESM_CDN_ORIGIN) {
        throw new TypeError(`Project dependency source blocked by allow-list: ${url.origin}`);
      }
    },
  });
}

/**
 * Resolve project-declared npm dependencies to their pinned CDN source so the
 * discovery bundle inlines them.
 *
 * `packages: "external"` leaves every bare specifier in the emitted module,
 * where `rewriteForDeno` prefixes it with `npm:`. A compiled binary resolves
 * that against the npm package set frozen into it at build time from the
 * framework's own lock, which a project's own dependency is never part of, and
 * answers `Could not find constraint '<pkg>@<version>' in the list of
 * packages`. Inlining the declared pin is what makes the dependency loadable.
 */
function createProjectDependencyCdnPlugin(
  pins: Record<string, string>,
  onInlined: (specifier: string) => void,
): Plugin {
  return {
    name: "veryfront-project-npm-cdn",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        // Imports reached through a fetched module are the HTTP plugin's.
        if (args.namespace === "http-url") return undefined;

        const { name, subpath } = splitPackageSubpath(args.path);
        const version = pins[name];
        if (!version || isFrameworkProvidedPackage(name)) return undefined;

        onInlined(args.path);
        return {
          path: `${ESM_CDN_BASE}/${name}@${version}${subpath === "." ? "" : subpath.slice(1)}`,
          namespace: "http-url",
        };
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
  if (!isExplicitHostProjectCodeExecutionAllowed(context)) {
    throw new TypeError(
      "Discovery module host loading requires explicit trusted-local execution",
    );
  }

  // Ensure veryfront modules are available as globals for compiled binaries
  await ensureVeryfrontGlobals();

  const filePath = file.replace("file://", "");

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

  // A compiled binary cannot resolve `npm:` specifiers for project code, so its
  // declared dependency pins decide what the bundler inlines below.
  const compiled = context.compiledRuntime ?? isDenoCompiled;
  const dependencyPins = compiled ? await readProjectDependencyPins(context) : {};

  // A shared hosted runtime serves many projects and source generations, so
  // namespace identical relative paths before considering entry contents.
  // The entry hash alone is still not enough: bundled relative imports are
  // inlined, so cached entries are only served after their recorded dependency
  // contents re-verify, and a pin bump changes the inlined package source
  // without touching the entry file.
  const cacheNamespace = context.cacheNamespace ?? context.baseDir ?? "";
  const cacheKey = JSON.stringify([
    cacheNamespace,
    file,
    await computeHash(source),
    dependencyPins,
  ]);
  const cachedEntries = transpileCache.get(cacheKey);
  if (cachedEntries) {
    const cached = await findCachedModuleWithFreshDeps(cachedEntries, context);
    if (cached) return cached;
  }

  const loader = getEsbuildLoader(filePath);
  await ensureDefaultBundlerContracts();
  const { build } = await import("veryfront/extensions/bundler");
  const fileDir = pathHelper.dirname(filePath);

  // When using fsAdapter (VFS), bundle all relative imports via the plugin.
  // Only mark relative imports as external when running in Deno without VFS
  // (local filesystem where Deno can resolve them natively).
  const hasFsAdapter = !!context.fsAdapter;
  const relativeImports = isDeno && !isDenoCompiled && !hasFsAdapter
    ? [...source.matchAll(/from\s+["'](\.\.[^"']+)["']/g)].map((m) => m[1]!).filter(Boolean)
    : [];

  // Use fsAdapter plugin whenever a VFS adapter is available (regardless of
  // runtime), recording every bundled dependency for cache re-validation.
  const bundledDeps: Array<{ path: string; content: string }> = [];
  const plugins: Plugin[] = hasFsAdapter
    ? [
      createFsAdapterPlugin(context.fsAdapter!, (path, content) => {
        bundledDeps.push({ path, content });
      }),
    ]
    : [];

  const inlinedDependencies = new Set<string>();
  if (Object.keys(dependencyPins).length > 0) {
    plugins.push(
      createProjectDependencyCdnPlugin(
        dependencyPins,
        (specifier) => inlinedDependencies.add(specifier),
      ),
      createHTTPPlugin({ fetchFn: fetchProjectDependencySource }),
    );
  }

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
      ...relativeImports,
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
    const text = result.errors[0]?.text ?? "unknown error";
    const detail = `Failed to transpile ${filePath}: ${text}`;
    // A CDN failure names an unreachable project dependency, not broken source.
    if (text.includes(ESM_CDN_BASE)) {
      throw DEPENDENCY_MISSING.create({ detail });
    }
    throw COMPILATION_ERROR.create({ detail });
  }

  const js = result.outputFiles?.[0]?.text ?? "export {}";

  const localFs = createFileSystem();
  const tempDir = await localFs.makeTempDir({ prefix: "vf-discovery-" });
  const tempFile = pathHelper.join(tempDir, "module.mjs");

  const transformedCode = isDeno
    ? rewriteForDeno(js, fileDir)
    : await rewriteDiscoveryImports(js, context.baseDir ?? ".", localFs, fileDir);

  await localFs.writeTextFile(tempFile, transformedCode);

  try {
    const moduleUrl = pathHelper.toFileUrl(tempFile);
    moduleUrl.searchParams.set("v", String(Date.now()));
    let module: unknown;
    try {
      module = await import(moduleUrl.href);
    } catch (error) {
      const unresolvable = describeUnresolvableNpmImport(error);
      if (!unresolvable) throw error;
      throw DEPENDENCY_MISSING.create({
        detail: `${filePath} imports "${unresolvable}", which this runtime cannot resolve. ` +
          `Declare the package in the project's package.json with an exact version so its ` +
          `source is bundled with the module, or move the work to an extension or a sandbox session.`,
        cause: error,
      });
    }
    const deps = await Promise.all(
      bundledDeps.map(async ({ path, content }) => ({ path, hash: await computeHash(content) })),
    );
    const entries = transpileCache.get(cacheKey) ?? [];
    entries.push({ deps, module });
    transpileCache.set(cacheKey, entries);
    return module;
  } finally {
    await localFs.remove(tempDir, { recursive: true });
  }
}

/**
 * Clear the transpile cache
 */
export function clearTranspileCache(): void {
  transpileCache.clear();
}
