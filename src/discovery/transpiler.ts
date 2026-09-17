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
import { readHttpModuleText } from "#veryfront/transforms/shared/http-module-response.ts";
import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
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
 * Upper bound on how many project dependencies one module may fall back to the
 * CDN for. Each fallback costs a bundle pass, and a tool file that needs more
 * than a handful of packages the runtime cannot resolve belongs in an
 * extension rather than in discovery.
 */
const MAX_CDN_DEPENDENCY_FALLBACKS = 4;

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
 * The package an esm.sh module path pins, or `null` for anything off the CDN.
 * esm.sh addresses a package as `/zod@3.25.76/es2022/zod.mjs` and a scoped one
 * as `/@scope/pkg@1.0.0/mod.js`, optionally behind a `/v135/` build prefix.
 *
 * @internal Exported for testing only.
 */
export function esmCdnPackageName(url: URL): string | null {
  if (url.origin !== ESM_CDN_ORIGIN) return null;
  const segments = url.pathname.replace(/^\/(?:v\d+|stable)\//, "/").split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const scoped = segments[0]!.startsWith("@") && segments.length > 1;
  const pinned = scoped ? `${segments[0]}/${segments[1]}` : segments[0]!;
  const name = pinned.replace(/@[^@/]+$/, "");
  return name.length > 0 ? name : null;
}

/**
 * Pinned CDN sources are immutable, so one process fetches each URL once even
 * when the module cache is missed by a source edit or a second project that
 * declares the same pin. This is a latency cache only: it is not durable, so
 * a restart still re-fetches (see the follow-up on an on-disk dependency cache).
 */
const MAX_CACHED_DEPENDENCY_SOURCES = 256;
const dependencySourceCache = new Map<string, { body: string; contentType: string }>();

function cacheableSourceKey(input: RequestInfo | URL): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return null;
}

/**
 * Project dependency sources are fetched through the host egress ceiling and
 * only from the pinned ESM CDN: a project supplies the package name and the
 * version it declared, never the host.
 *
 * @internal Exported for testing only.
 */
export async function fetchProjectDependencySource(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const key = cacheableSourceKey(input);
  const cached = key ? dependencySourceCache.get(key) : undefined;
  if (cached) {
    return new Response(cached.body, { headers: { "content-type": cached.contentType } });
  }

  const response = await guardedOutboundFetch(input, init, {
    authorizeUrl: (url) => {
      if (url.origin !== ESM_CDN_ORIGIN) {
        throw new TypeError(`Project dependency source blocked by allow-list: ${url.origin}`);
      }
    },
  });
  if (!key || !response.ok) return response;

  // Read through the same bounded reader the bundler plugin uses, so caching
  // never buffers more of a CDN response than the plugin would have accepted.
  const contentType = response.headers.get("content-type") ?? "application/javascript";
  const body = await readHttpModuleText(response, MAX_BUNDLE_CHUNK_SIZE_BYTES);
  // An esm.sh build failure is served as HTML with a 200; caching it would
  // pin that failure for the life of the process.
  const isHtml = contentType.includes("text/html") || body.trimStart().startsWith("<");
  if (!isHtml) {
    if (dependencySourceCache.size >= MAX_CACHED_DEPENDENCY_SOURCES) {
      const oldest = dependencySourceCache.keys().next();
      if (!oldest.done) dependencySourceCache.delete(oldest.value);
    }
    dependencySourceCache.set(key, { body, contentType });
  }
  return new Response(body, { headers: { "content-type": contentType } });
}

/**
 * Resolve the named project dependencies to their pinned CDN source so the
 * discovery bundle inlines them.
 *
 * `packages: "external"` leaves every bare specifier in the emitted module,
 * where `rewriteForDeno` prefixes it with `npm:`. A compiled binary resolves
 * that against the npm package set frozen into it at build time from the
 * framework's own lock, which a project's own dependency is never part of, and
 * answers `Could not find constraint '<pkg>@<version>' in the list of
 * packages`. Inlining the declared pin is what makes the dependency loadable.
 *
 * `packages` holds only the names the runtime has already refused, so a
 * dependency the binary can resolve natively — any of the hundreds of packages
 * frozen into it — is never rerouted to the network.
 */
/**
 * The package a discovery import names, whether written bare (`unpdf`,
 * `unpdf/dist/core`) or as a Deno npm specifier (`npm:unpdf@1.8.1`).
 *
 * Both forms reach the same frozen package set in a compiled binary, so both
 * have to be recognised against the project's declared pins. A project that
 * hit the bare-import failure typically rewrites it to the versioned `npm:`
 * form, which must not then fall through unrecognised.
 * `requestedVersion` is whatever the specifier itself pinned, else `null`.
 *
 * @internal Exported for testing only.
 */
export function parseNpmImportSpecifier(
  specifier: string,
): { name: string; subpath: string; requestedVersion: string | null } {
  const bare = specifier.startsWith("npm:") ? specifier.slice("npm:".length) : specifier;

  // A version sits between the package name and any subpath (`pkg@1.2.3/sub`,
  // `@scope/pkg@1.2.3/sub`); the `@` opening a scope is not a separator.
  const at = bare.indexOf("@", bare.startsWith("@") ? 1 : 0);
  if (at === -1) return { ...splitPackageSubpath(bare), requestedVersion: null };

  const slash = bare.indexOf("/", at);
  const rest = slash === -1 ? "" : bare.slice(slash + 1);
  return {
    name: bare.slice(0, at),
    subpath: rest ? `./${rest}` : ".",
    requestedVersion: bare.slice(at + 1, slash === -1 ? undefined : slash) || null,
  };
}

function createProjectDependencyCdnPlugin(
  pins: Record<string, string>,
  packages: ReadonlySet<string>,
): Plugin {
  return {
    name: "veryfront-project-npm-cdn",
    setup(build: PluginBuild) {
      // Registered before the HTTP plugin's own http-url resolver so a
      // framework-provided package reached transitively from fetched CDN
      // source (esm.sh emits `/zod@3.25.76/es2022/zod.mjs`) is handed back to
      // the runtime instead of inlined as a second copy. The registries
      // compare schema and element identities against the framework's
      // instance, which a duplicate would fail.
      build.onResolve({ filter: /.*/, namespace: "http-url" }, (args) => {
        let url: URL;
        try {
          url = new URL(args.path, args.importer);
        } catch (_) {
          /* expected: a non-URL specifier is the HTTP plugin's to resolve */
          return undefined;
        }
        const name = esmCdnPackageName(url);
        if (!name || !isFrameworkProvidedPackage(name)) return undefined;
        return { path: name, external: true };
      });

      build.onResolve({ filter: /^[^./]/ }, (args) => {
        // Imports reached through a fetched module are the HTTP plugin's.
        if (args.namespace === "http-url") return undefined;

        const { name, subpath, requestedVersion } = parseNpmImportSpecifier(args.path);
        if (isFrameworkProvidedPackage(name)) return undefined;
        const version = pins[name];
        if (!version) return undefined;

        // A statically imported bare specifier waits for the runtime to
        // actually refuse it, so a package the binary can resolve natively is
        // never sent to the network. Two forms cannot wait, because their
        // refusal arrives after discovery has returned and so never reaches
        // the retry below: an `await import()` evaluated inside a handler, and
        // the explicit `npm:pkg@version` form a project reaches for once its
        // bare import has failed. Both named a package the project declared.
        const deferred = args.kind === "dynamic-import" || args.path.startsWith("npm:");
        if (!deferred && !packages.has(name)) return undefined;
        // The package.json declaration is what authorizes a CDN fetch, so a
        // specifier pinning a *different* version is not this plugin's to
        // serve: inlining the declared pin under the requested coordinate runs
        // code the import did not ask for, and honouring the request fetches a
        // version the project never declared. Left unresolved it surfaces the
        // classified DEPENDENCY_MISSING naming the package.
        if (requestedVersion && requestedVersion !== version) return undefined;

        return {
          path: `${ESM_CDN_BASE}/${name}@${version}${subpath === "." ? "" : subpath.slice(1)}`,
          namespace: "http-url",
        };
      });
    },
  };
}

/** Longest text esbuild hands back for a failed build, used for classification. */
function describeBundleFailure(error: unknown): string {
  const failure = error as { errors?: ReadonlyArray<{ text?: unknown }> } | null;
  const first = failure?.errors?.[0]?.text;
  if (typeof first === "string" && first.length > 0) return first;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Classify a failed discovery bundle.
 *
 * The bundler wrapper throws on build errors rather than returning them, so
 * this must be reached from a `catch`; a `result.errors` guard never fires.
 */
function bundleFailureError(filePath: string, error: unknown): Error {
  const text = describeBundleFailure(error);
  const detail = `Failed to transpile ${filePath}: ${text}`;
  // A CDN failure names an unreachable project dependency, not broken source.
  if (text.includes(ESM_CDN_BASE)) {
    return DEPENDENCY_MISSING.create({ detail, cause: error });
  }
  return COMPILATION_ERROR.create({ detail, cause: error });
}

/**
 * The project dependency to retry from its pinned CDN source, or `null` when
 * the failure is not a runtime npm resolution the project can answer.
 */
function nextCdnFallbackPackage(
  error: unknown,
  pins: Record<string, string>,
  attempted: ReadonlySet<string>,
): string | null {
  const unresolvable = describeUnresolvableNpmImport(error);
  if (!unresolvable) return null;
  // The runtime names the specifier it refused: `unpdf@1.8.1`, `unpdf/dist`
  // or `@scope/pkg@1.0.0`.
  const pkg = parseNpmImportSpecifier(unresolvable).name;
  if (attempted.has(pkg) || isFrameworkProvidedPackage(pkg) || !pins[pkg]) return null;
  return pkg;
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

  const localFs = createFileSystem();

  /**
   * One bundle-and-import pass. `cdnPackages` names the project dependencies
   * this pass resolves from their pinned CDN source; it is empty on the first
   * pass, so an unchanged runtime resolves exactly what it resolves today.
   */
  const attemptImport = async (
    cdnPackages: ReadonlySet<string>,
  ): Promise<{ module: unknown; deps: ReadonlyArray<{ path: string; hash: string }> }> => {
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

    // Registered whenever the project declares a pin, not only on a retry
    // pass: an explicit `npm:` specifier is resolved eagerly (see the plugin),
    // and a deferred `await import("npm:pkg@x")` never produces the refusal
    // that would trigger a retry. With an empty `cdnPackages` a bare specifier
    // still falls through, so an unchanged runtime resolves what it does today.
    if (Object.keys(dependencyPins).length > 0) {
      plugins.push(
        createProjectDependencyCdnPlugin(dependencyPins, cdnPackages),
        createHTTPPlugin({ fetchFn: fetchProjectDependencySource }),
      );
    }

    let result;
    try {
      result = await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        target: "es2022",
        jsx: "automatic",
        jsxImportSource: "react",
        resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
        plugins,
        // Externalize all bare-specifier imports so npm packages a tool/agent
        // file depends on (e.g. `pdf-parse`, `mammoth`) are not pulled into the
        // discovery bundle. Discovery only needs the module's exports; the
        // implementation runs server-side at request time and can resolve npm
        // packages natively via the project's node_modules / import map.
        // Without this, esbuild under platform: "neutral" tries to bundle CJS
        // npm packages and fails on their Node built-in references (fs, http).
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
          // Must be a basename: esbuild joins resolveDir + sourcefile to form
          // the entry module path when sourcefile is relative. Passing the full
          // relative filePath (e.g. "tools/foo.ts") on VFS runs (baseDir === "")
          // doubles the prefix to "tools/tools/foo.ts", which anchors ../
          // imports one directory too deep.
          sourcefile: pathHelper.basename(filePath),
        },
      });
    } catch (error) {
      // The bundler wrapper throws a build failure instead of returning it.
      throw bundleFailureError(filePath, error);
    }
    if (result.errors.length > 0) throw bundleFailureError(filePath, result);

    const js = result.outputFiles?.[0]?.text ?? "export {}";

    const tempDir = await localFs.makeTempDir({ prefix: "vf-discovery-" });
    const tempFile = pathHelper.join(tempDir, "module.mjs");

    const transformedCode = isDeno
      ? rewriteForDeno(js, fileDir)
      : await rewriteDiscoveryImports(js, context.baseDir ?? ".", localFs, fileDir);

    await localFs.writeTextFile(tempFile, transformedCode);

    try {
      const moduleUrl = pathHelper.toFileUrl(tempFile);
      moduleUrl.searchParams.set("v", String(Date.now()));
      const module = await import(moduleUrl.href);
      const deps = await Promise.all(
        bundledDeps.map(async ({ path, content }) => ({ path, hash: await computeHash(content) })),
      );
      return { module, deps };
    } finally {
      await localFs.remove(tempDir, { recursive: true });
    }
  };

  // Only a dependency the runtime has actually refused is refetched from the
  // CDN, so packages frozen into a compiled binary keep resolving offline and
  // an outage cannot break a module that loads today. Each pass can only name
  // the first specifier that failed, so a module with several unresolvable
  // dependencies converges over a bounded number of passes.
  const cdnPackages = new Set<string>();
  for (;;) {
    try {
      const { module, deps } = await attemptImport(cdnPackages);
      const entries = transpileCache.get(cacheKey) ?? [];
      entries.push({ deps, module });
      transpileCache.set(cacheKey, entries);
      return module;
    } catch (error) {
      const fallback = cdnPackages.size < MAX_CDN_DEPENDENCY_FALLBACKS
        ? nextCdnFallbackPackage(error, dependencyPins, cdnPackages)
        : null;
      if (fallback) {
        cdnPackages.add(fallback);
        continue;
      }
      const unresolvable = describeUnresolvableNpmImport(error);
      if (!unresolvable) throw error;
      throw DEPENDENCY_MISSING.create({
        detail: `${filePath} imports "${unresolvable}", which this runtime cannot resolve. ` +
          `Declare the package in the project's package.json with an exact version so its ` +
          `source is bundled with the module, or move the work to an extension or a sandbox session.`,
        cause: error,
      });
    }
  }
}

/**
 * Clear the transpile cache
 */
export function clearTranspileCache(): void {
  transpileCache.clear();
  dependencySourceCache.clear();
}
