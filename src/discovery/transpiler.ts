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
import {
  classifyProjectNpmImport,
  describeNpmImport,
  isFrameworkProvidedPackage,
  nodeBuiltinSpecifier,
  parseNpmSpecifier,
} from "./project-npm-imports.ts";
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
          // A relative import reached from fetched CDN source addresses another
          // module of that package (esm.sh splits packages across files), not a
          // project file: it belongs to the HTTP plugin, which is registered
          // after this one.
          if (args.namespace === "http-url") return undefined;
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
 * Dependency declarations from a project's package.json, VERBATIM.
 *
 * The ranges are kept rather than filtered here because `npm install` writes a
 * caret range by default: dropping everything that is not already an exact
 * version discarded the pin for the overwhelmingly common `"unpdf": "^1.8.1"`
 * and left the import with nothing to inline.
 * `exactVersionNamedByRange` (src/discovery/project-npm-imports.ts) is what
 * reduces a declaration to the single version it names, at the one place that
 * needs a CDN coordinate.
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

  const pkg = parsed as {
    peerDependencies?: unknown;
    dependencies?: unknown;
    devDependencies?: unknown;
    optionalDependencies?: unknown;
  };
  const pins: Record<string, string> = {};
  // Later groups override earlier ones. A peer dependency is installed and
  // importable, but its range is the widest statement of what the project
  // accepts, so any installed declaration of the same name wins over it. npm
  // lets an `optionalDependencies` entry override a `dependencies` entry.
  const groups = [
    pkg?.peerDependencies,
    pkg?.dependencies,
    pkg?.devDependencies,
    pkg?.optionalDependencies,
  ];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    for (const [name, range] of Object.entries(group as Record<string, unknown>)) {
      // `__proto__` is no npm package name, and assigning it would replace the
      // prototype of the pin table instead of adding an entry.
      if (name === "__proto__") continue;
      if (typeof range === "string" && range.trim().length > 0) pins[name] = range.trim();
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
 * The package a compiled binary refused to resolve, or `null` when
 * the failure is unrelated. Deno answers an `npm:` specifier that is not in a
 * compiled binary's frozen package set with
 * `Could not find constraint 'unpdf@1.8.1' in the list of packages.`
 *
 * @internal Exported for testing only.
 */
export function describeUnresolvableNpmImport(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const quoted = /Could not find constraint '([^']+)'/.exec(message)?.[1] ??
    /Could not resolve ["']npm:([^"']+)["']/.exec(message)?.[1] ??
    /npm package '([^']+)' does not exist/.exec(message)?.[1];
  if (quoted === undefined) return null;
  // Only the package is named: the version and subpath Deno quotes are project
  // text a framework import carries past classification unchecked, and a valid
  // pre-release suffix (`zod@4.3.6-<TOKEN>`) can hold anything.
  return parseNpmSpecifier(quoted)?.name ?? "an npm package";
}

const ESM_CDN_ORIGIN = new URL(ESM_CDN_BASE).origin;

/**
 * The build-target directory esm.sh puts between a package pin and the module
 * file it built: `/react@19.2.4/es2022/jsx-runtime.mjs`. It addresses esm.sh's
 * own output layout, not the package's export map, so it is not part of the
 * subpath the package itself publishes.
 */
const ESM_CDN_BUILD_TARGET = /^(?:es(?:next|\d{4})|denonext|deno|node|bun|browser)$/;

/**
 * The segment esm.sh puts between a package pin and the build target when the
 * build has options: `/react@19.2.4/X-ZGNzc3R5cGVAMy4yLjMKZXJlYWN0/es2022/...`
 * (base64 of the options). Like the target, it is esm.sh's own layout.
 */
const ESM_CDN_BUILD_OPTIONS = /^X-[A-Za-z0-9_-]+$/;

/**
 * The extension esm.sh gives a built module file, with the build-variant
 * suffixes it adds for `?dev` and `?bundle` builds
 * (`jsx-dev-runtime.development.mjs`, `client.bundle.mjs`): each variant is
 * the same package export.
 */
const ESM_CDN_MODULE_EXTENSION = /(?:\.(?:development|bundle|nobundle))*\.[mc]?js$/;

/**
 * The package, and the package subpath, an esm.sh module path addresses.
 * `null` for anything off the CDN.
 *
 * esm.sh addresses a package as `/zod@3.25.76/es2022/zod.mjs` and a scoped one
 * as `/@scope/pkg@1.0.0/es2022/pkg.mjs`, optionally behind a `/v135/` build
 * prefix. What follows the pin is the built file, so the package's own subpath
 * is what is left after the `X-<options>` segment (when present), the
 * build-target directory and the file extension come off: `/react@19.2.4/es2022/jsx-runtime.mjs` is `react/jsx-runtime`, while
 * `/react@19.2.4/es2022/react.mjs` -- whose file is named after the package
 * itself -- is the package root.
 */
function parseEsmCdnModule(url: URL): { name: string; subpath: string } | null {
  if (url.origin !== ESM_CDN_ORIGIN) return null;
  const segments = url.pathname.replace(/^\/(?:v\d+|stable)\//, "/").split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const scoped = segments[0]!.startsWith("@") && segments.length > 1;
  const pinned = scoped ? `${segments[0]}/${segments[1]}` : segments[0]!;
  const name = pinned.replace(/@[^@/]+$/, "");
  if (name.length === 0) return null;

  let rest = segments.slice(scoped ? 2 : 1);
  if (rest.length > 0 && ESM_CDN_BUILD_OPTIONS.test(rest[0]!)) rest = rest.slice(1);
  if (rest.length > 0 && ESM_CDN_BUILD_TARGET.test(rest[0]!)) rest = rest.slice(1);
  const file = rest.join("/").replace(ESM_CDN_MODULE_EXTENSION, "");
  // esm.sh names the root module after the package, so a file matching the
  // package's own last name segment is the root rather than a subpath.
  const rootModuleName = name.slice(name.lastIndexOf("/") + 1);
  const subpath = file.length === 0 || file === rootModuleName ? "" : file;
  return { name, subpath };
}

/**
 * The package an esm.sh module path pins, or `null` for anything off the CDN.
 *
 * @internal Exported for testing only.
 */
export function esmCdnPackageName(url: URL): string | null {
  return parseEsmCdnModule(url)?.name ?? null;
}

/**
 * The bare specifier an esm.sh module path stands in for -- `react` for the
 * package root, `react/jsx-runtime` for a subpath -- or `null` for anything
 * off the CDN.
 *
 * This is what the http-url guard externalizes in place of a fetched URL, and
 * the subpath is the whole point: collapsing every matching URL to the bare
 * package name turned an inlined dependency's `react/jsx-runtime` import into
 * an import of `react`, whose root export has no `jsx` or `jsxs`. Every JSX
 * element in that module then failed at load time.
 *
 * @internal Exported for testing only.
 */
export function esmCdnModuleSpecifier(url: URL): string | null {
  const parsed = parseEsmCdnModule(url);
  if (!parsed) return null;
  return parsed.subpath.length > 0 ? `${parsed.name}/${parsed.subpath}` : parsed.name;
}

/**
 * Pinned CDN sources are immutable, so one process fetches each URL once even
 * when the module cache is missed by a source edit or a second project that
 * declares the same pin. This is a latency cache only: it is not durable, so
 * a restart still re-fetches (see the follow-up on an on-disk dependency cache).
 */
const MAX_CACHED_DEPENDENCY_SOURCES = 256;
/**
 * The total source text the cache may hold. The entry cap alone let a shared
 * runtime retain 256 bodies of up to MAX_BUNDLE_CHUNK_SIZE_BYTES each -- about
 * 1 GiB of tenant-selected source -- before evicting anything.
 */
const MAX_CACHED_DEPENDENCY_SOURCE_BYTES = 32 * 1024 * 1024;
const dependencySourceCache = new Map<string, { body: string; contentType: string }>();
let dependencySourceCacheBytes = 0;

/** UTF-16 code units are what a cached string costs, at up to two bytes each. */
function cachedSourceBytes(body: string): number {
  return body.length * 2;
}

function evictOldestDependencySource(): void {
  const oldest = dependencySourceCache.entries().next();
  if (oldest.done) return;
  dependencySourceCache.delete(oldest.value[0]);
  dependencySourceCacheBytes -= cachedSourceBytes(oldest.value[1].body);
}

function clearDependencySourceCache(): void {
  dependencySourceCache.clear();
  dependencySourceCacheBytes = 0;
}

function cacheableSourceKey(input: RequestInfo | URL): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return null;
}

/**
 * The allow-list a project dependency source URL must pass before any request
 * leaves: a project supplies the package name and the version it declared,
 * never the host.
 *
 * @internal Exported for testing only.
 */
export function authorizeProjectDependencySourceUrl(url: URL): void {
  if (url.origin !== ESM_CDN_ORIGIN) {
    throw new TypeError(`Project dependency source blocked by allow-list: ${url.origin}`);
  }
}

/** Sends one project dependency source request. */
type DependencySourceTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * A dependency source fetcher over `transport` that serves each pinned URL
 * from the process-wide source cache after its first successful fetch.
 *
 * @internal Exported for testing only.
 */
export function createProjectDependencySourceFetcher(
  transport: DependencySourceTransport,
  { maxBytes = MAX_CACHED_DEPENDENCY_SOURCE_BYTES }: { maxBytes?: number } = {},
): DependencySourceTransport {
  return async (input, init) => {
    const key = cacheableSourceKey(input);
    const cached = key ? dependencySourceCache.get(key) : undefined;
    if (cached) {
      return new Response(cached.body, { headers: { "content-type": cached.contentType } });
    }

    const response = await transport(input, init);
    if (!key || !response.ok) return response;

    // Read through the same bounded reader the bundler plugin uses, so caching
    // never buffers more of a CDN response than the plugin would have accepted.
    const contentType = response.headers.get("content-type") ?? "application/javascript";
    const body = await readHttpModuleText(response, MAX_BUNDLE_CHUNK_SIZE_BYTES);
    // An esm.sh build failure is served as HTML with a 200; caching it would
    // pin that failure for the life of the process.
    const isHtml = contentType.includes("text/html") || body.trimStart().startsWith("<");
    const bytes = cachedSourceBytes(body);
    // A concurrent miss for the same URL may have filled the entry while this
    // one was in flight; replacing it would count the same source twice.
    if (!isHtml && bytes <= maxBytes && !dependencySourceCache.has(key)) {
      while (
        dependencySourceCache.size > 0 &&
        (dependencySourceCache.size >= MAX_CACHED_DEPENDENCY_SOURCES ||
          dependencySourceCacheBytes + bytes > maxBytes)
      ) evictOldestDependencySource();
      dependencySourceCache.set(key, { body, contentType });
      dependencySourceCacheBytes += bytes;
    }
    return new Response(body, { headers: { "content-type": contentType } });
  };
}

/**
 * Project dependency sources are fetched through the host egress ceiling and
 * only from the pinned ESM CDN (see {@link authorizeProjectDependencySourceUrl}).
 *
 * @internal Exported for testing only.
 */
export const fetchProjectDependencySource: DependencySourceTransport =
  createProjectDependencySourceFetcher((input, init) =>
    guardedOutboundFetch(input, init, { authorizeUrl: authorizeProjectDependencySourceUrl })
  );

/** Where a deferred import nothing may serve is bundled as a throwing module. */
const MISSING_DEPENDENCY_NAMESPACE = "veryfront-missing-npm-dependency";

/**
 * Resolve a project's npm imports the way a compiled runtime can serve them.
 *
 * `packages: "external"` leaves every bare specifier in the emitted module,
 * where `rewriteForDeno` prefixes it with `npm:`. A compiled binary resolves
 * that against the npm package set frozen into it at build time from the
 * framework's own lock, and answers `Could not find constraint
 * '<pkg>@<version>' in the list of packages` for anything outside it.
 * {@link classifyProjectNpmImport} decides, per specifier, whether the binary
 * already carries the package (leave it external), whether the project's
 * declared pin has to be inlined from its CDN source instead, or whether
 * nothing can serve it.
 *
 * esbuild calls this for a deferred `import()` inside a handler body exactly
 * as it does for a top-level one, which is what makes the production failure
 * reachable from here: an inlined dynamic import stays lazy in the output.
 *
 * @internal Exported for testing only.
 */
export function createProjectDependencyCdnPlugin(
  pins: Record<string, string>,
  onMissing: (specifier: string, reason: string) => void,
): Plugin {
  return {
    name: "veryfront-project-npm-cdn",
    setup(build: PluginBuild) {
      // A URL the project imports directly is the runtime's to fetch, exactly
      // as on a run with no declared dependency. Registered before the HTTP
      // plugin, whose resolver would otherwise claim it and send it to a
      // fetcher that admits only the pinned CDN -- turning an unrelated
      // `https://deno.land/...` import into a compilation error.
      build.onResolve(
        { filter: /^https?:\/\// },
        (args) => args.namespace === "http-url" ? undefined : { path: args.path, external: true },
      );

      // A deferred import nothing may serve is bundled as a module that throws
      // when the import is reached, carrying the classified reason.
      build.onLoad({ filter: /.*/, namespace: MISSING_DEPENDENCY_NAMESPACE }, (args) => ({
        contents: `throw new Error(${
          JSON.stringify(typeof args.pluginData === "string" ? args.pluginData : "")
        });`,
        loader: "js",
      }));

      // Registered before the HTTP plugin's own http-url resolver so a
      // framework-provided package reached transitively from fetched CDN
      // source (esm.sh emits `/zod@3.25.76/es2022/zod.mjs`) is handed back to
      // the runtime instead of inlined as a second copy. The registries
      // compare schema and element identities against the framework's
      // instance, which a duplicate would fail. Without this guard a single
      // CDN-inlined project dependency pulls a second zod, a second
      // @opentelemetry/* and a second veryfront into the discovery bundle.
      build.onResolve({ filter: /.*/, namespace: "http-url" }, (args) => {
        let url: URL;
        try {
          url = new URL(args.path, args.importer);
        } catch (_) {
          /* expected: a non-URL specifier is the HTTP plugin's to resolve */
          return undefined;
        }
        const parsed = parseEsmCdnModule(url);
        // A CDN URL always names an npm package: `/buffer@6.0.3/...` is the npm
        // `buffer` polyfill at that version, not `node:buffer`, so only the
        // framework's own packages are handed back here.
        if (
          !parsed || !isFrameworkProvidedPackage(parsed.name) ||
          nodeBuiltinSpecifier(parsed.name) !== null
        ) return undefined;
        // The SUBPATH has to survive: `react/jsx-runtime` externalized as
        // `react` imports a module with no `jsx` or `jsxs` export, so every
        // JSX element in the inlined dependency fails when it loads.
        return { path: esmCdnModuleSpecifier(url)!, external: true };
      });

      build.onResolve({ filter: /^[^./]/ }, (args) => {
        // Imports reached through a fetched module are the HTTP plugin's.
        if (args.namespace === "http-url") return undefined;

        // A bare Node builtin (`crypto`, `fs/promises`) is pinned to its
        // `node:` form here. Left bare it survives into the emitted module,
        // where `rewriteBareNpmImportsForDeno` turns it into `npm:crypto` --
        // an unrelated npm shim package no compiled binary carries.
        const builtin = nodeBuiltinSpecifier(args.path);
        if (builtin) return { path: builtin, external: true };

        const decision = classifyProjectNpmImport(args.path, pins);
        if (decision.kind === "runtime") {
          return decision.specifier === undefined
            ? undefined
            : { path: decision.specifier, external: true };
        }

        if (decision.kind === "missing") {
          // The specifier is project source and can carry a credential
          // (`npm:pkg@https://<TOKEN>@host/x`), so only its redacted form is
          // reported.
          const shown = describeNpmImport(args.path);

          // A deferred `import()` -- or its CommonJS forms, `require()` and
          // `require.resolve()` -- inside a handler body is the project's own
          // lazy path, and often an optional one behind a try/catch. Failing
          // the bundle for it would delete every unrelated export of the file
          // -- tools, agents, schemas -- from discovery, which is a strictly
          // larger blast radius than the failure it replaces. The failure is
          // deferred to call time instead, when the import is actually reached.
          // It is not handed back to the runtime: for an import the project's
          // own declaration contradicts, the runtime could load the very
          // version package.json rules out.
          //
          // A STATIC import is different: nothing can load the module without
          // it, so the file was going to fail either way. Failing here is the
          // same blast radius reported earlier and with a classified reason
          // instead of Deno's raw constraint text.
          if (
            args.kind === "dynamic-import" || args.kind === "require-call" ||
            args.kind === "require-resolve"
          ) {
            return {
              path: shown,
              namespace: MISSING_DEPENDENCY_NAMESPACE,
              pluginData: `Cannot load "${shown}": ${decision.reason}`,
            };
          }

          onMissing(shown, decision.reason);
          // Stops the build; importModule turns the recorded specifiers into a
          // classified DEPENDENCY_MISSING rather than reading this text back.
          return { errors: [{ text: `Cannot resolve "${shown}": ${decision.reason}` }] };
        }

        const { name, version, subpath } = decision;
        return {
          path: `${ESM_CDN_BASE}/${name}@${version}${subpath === "." ? "" : subpath.slice(1)}`,
          namespace: "http-url",
        };
      });
    },
  };
}

/** A specifier the bundler refused, with why nothing could serve it. */
interface MissingProjectDependency {
  specifier: string;
  reason: string;
}

/**
 * The most specific text esbuild hands back for a failed build.
 *
 * esbuild attaches its diagnostics to the rejection as `errors`, and only the
 * first of those names the offending file and line. The rejection's own
 * `message` is the summary line -- `Build failed with 1 error:` -- so reading
 * `message` alone is how a plain syntax error in project code reached the user
 * with no file path in it.
 */
function describeBundleFailure(failure: unknown): string {
  const withErrors = failure as { errors?: ReadonlyArray<{ text?: unknown }> } | null;
  const first = withErrors?.errors?.[0]?.text;
  if (typeof first === "string" && first.length > 0) return first;
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * The name to give a discovered file in user-facing error detail.
 *
 * Hosted discovery already addresses its VFS with project-relative paths, but
 * a local filesystem run resolves the `file://` entry to an absolute machine
 * path -- `/Users/<name>/...` -- and AGENTS.md's secret and internal-detail
 * safety rules put a user home directory and a machine-specific filesystem
 * layout on the list of things user-facing output must never carry. The file
 * still has to be named, or the classified error is no more actionable than
 * the raw `Build failed with 1 error` text it replaced, so this renders the
 * path relative to the project root and falls back to the bare file name when
 * there is no root to render it against.
 *
 * @internal Exported for testing only.
 */
export function discoveryPathForDisplay(filePath: string, baseDir?: string): string {
  const root = portableRoot(baseDir);
  const file = toPortablePath(filePath);
  if (root.length > 0) {
    const prefix = isFilesystemRoot(root) ? root : `${root}/`;
    const under = isWindowsDrivePath(root)
      ? file.toLowerCase().startsWith(prefix.toLowerCase())
      : file.startsWith(prefix);
    if (under) return file.slice(prefix.length);
  }
  // A relative path is already free of machine layout; leave it as written.
  if (!isAbsoluteMachinePath(filePath)) return filePath;
  return pathHelper.basename(file);
}

/** `path` with `/` separators: the form the path helpers hand the bundler. */
function toPortablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * A project root in portable form, without redundant trailing separators. A
 * filesystem root keeps its separator: `/` and `C:/` are roots, `` and `C:`
 * are not.
 */
function portableRoot(baseDir: string | undefined): string {
  let trimmed = toPortablePath(baseDir ?? "");
  while (trimmed.endsWith("/") && !isFilesystemRoot(trimmed)) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

/** `/` or a Windows volume root such as `C:/`. */
function isFilesystemRoot(path: string): boolean {
  return path === "/" || /^[A-Za-z]:\/$/.test(path);
}

/** `C:/...`: compared case-insensitively, as Windows compares paths. */
function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path);
}

function isAbsoluteMachinePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * The raw entry path, the only form of it that may reach the user, and the
 * absolute project root to take out of anything else the bundler quotes (empty
 * when the root is relative and so discloses no machine layout).
 */
interface DiscoveryPathNames {
  raw: string;
  display: string;
  root: string;
}

/** @internal Exported for testing only. */
export function discoveryPathNames(filePath: string, baseDir?: string): DiscoveryPathNames {
  const root = portableRoot(baseDir);
  return {
    raw: filePath,
    display: discoveryPathForDisplay(filePath, baseDir),
    root: isAbsoluteMachinePath(root) ? root : "",
  };
}

/**
 * `text` with every mention of the raw entry path replaced by its display
 * form, and every other path under the project root rendered relative to it.
 * A platform or bundler message quotes the paths it was handed -- Deno's
 * `readTextFile '<absolute path>'`, esbuild's resolve diagnostics, the fsAdapter
 * plugin's importer directory -- which would put the machine layout back into
 * detail {@link discoveryPathForDisplay} just took out.
 *
 * @internal Exported for testing only.
 */
export function withDisplayPath(text: string, paths: DiscoveryPathNames): string {
  const shown = paths.raw === paths.display ? text : text.split(paths.raw).join(paths.display);
  if (paths.root.length === 0) return shown;
  return shown.replace(
    projectRootMention(paths.root),
    (_, separator: string | undefined) => separator === undefined ? "." : "",
  );
}

/**
 * The project root where it stands as a path of its own: introduced by
 * `file://` or not preceded by a path or host character, and followed by a
 * separator (consumed, so what
 * follows reads project-relative) or by something no path name continues
 * with. Matched as a bare substring, `/app` rewrote
 * `https://esm.sh/apple@1.0.0` to `https://esm.sh.le@1.0.0` -- which also hid
 * the CDN from the dependency classification.
 */
function projectRootMention(root: string): RegExp {
  // `root` is portable; a message may quote it with either separator.
  const escapePath = (path: string) =>
    path.split("/")
      .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
      .join(String.raw`[/\\]`);
  // A `file://` prefix is consumed with the root: Deno quotes module paths as
  // file URLs (`file:///C:/...` on Windows), and the `/` it ends with would
  // otherwise fail the boundary.
  const start = String.raw`(?:file:///?|(?<![A-Za-z0-9._~%@:/\\-]))`;
  // A filesystem root ends in its separator, so it is a mention only where a
  // path continues after it; the bare `/` of prose is left alone.
  const rest = isFilesystemRoot(root)
    ? String.raw`${escapePath(root.slice(0, -1))}([/\\])(?=[A-Za-z0-9._~%-])`
    : String.raw`${escapePath(root)}(?:([/\\])|(?![A-Za-z0-9._~%-]))`;
  return new RegExp(`${start}${rest}`, isWindowsDrivePath(root) ? "gi" : "g");
}

/**
 * A CDN URL in bundler text, with the pre-release and build parts of its
 * version replaced. The request uses the declared version verbatim, but both
 * parts are free-form under semver, so a token written into a declaration
 * would otherwise reach the classified detail through the failing URL.
 */
function withoutCdnVersionIdentifiers(text: string): string {
  const cdn = ESM_CDN_BASE.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return text.replace(
    new RegExp(
      String.raw`(${cdn}/\S*?@\d+(?:\.\d+){0,2})(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?`,
      "g",
    ),
    (_match, pinned: string, pre?: string, build?: string) =>
      `${pinned}${pre ? "-<redacted>" : ""}${build ? "+<redacted>" : ""}`,
  );
}

/**
 * Classify a bundle failure. Every failure leaves here classified: an
 * unclassified esbuild rejection reaching the user as raw
 * `Build failed with 1 error` text, with no slug and no file path, is the
 * surface #1440 asked to stop showing.
 *
 * Everything built here is user-facing detail, so the file is named through
 * `paths.display` and the bundler's own text is run through
 * {@link withDisplayPath}; `paths.raw` is never interpolated.
 *
 * The bundler wrapper rethrows esbuild's rejection instead of returning its
 * diagnostics, so this has to be reached from a catch -- the `result.errors`
 * guard alone never fires.
 */
function classifyBundleFailure(
  failure: unknown,
  paths: DiscoveryPathNames,
  missing: readonly MissingProjectDependency[],
): Error {
  const cause = failure instanceof Error ? failure : undefined;

  if (missing.length > 0) {
    const listed = missing.map(({ specifier, reason }) => `"${specifier}" (${reason})`).join("; ");
    return DEPENDENCY_MISSING.create({
      detail: `${paths.display} imports ${listed}. Declare the package in the project's ` +
        `package.json with an exact version and import that same version, or move the ` +
        `work to an extension or a sandbox session.`,
      cause,
    });
  }

  const text = withoutCdnVersionIdentifiers(withDisplayPath(describeBundleFailure(failure), paths));
  const detail = `Failed to transpile ${paths.display}: ${text}`;
  // A CDN failure names an unreachable project dependency, not broken source.
  if (text.includes(ESM_CDN_BASE)) {
    return DEPENDENCY_MISSING.create({ detail, cause });
  }
  // Anything else is project source the bundler could not compile.
  return COMPILATION_ERROR.create({ detail, cause });
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
  // Everything below names the file to the user through this, never through
  // `filePath`: on a local filesystem run that is an absolute machine path.
  const paths = discoveryPathNames(filePath, context.baseDir);

  let source: string;
  try {
    source = context.fsAdapter
      ? await context.fsAdapter.readFile(filePath)
      : await createFileSystem().readTextFile(filePath);
  } catch (error) {
    throw FILE_NOT_FOUND.create({
      detail: `Failed to read file ${paths.display}: ${withDisplayPath(String(error), paths)}`,
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
  // Compiled and uncompiled runs bundle the same source differently, so a
  // module built for one mode must never be served to the other.
  const cacheKey = JSON.stringify([
    cacheNamespace,
    file,
    await computeHash(source),
    compiled,
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

  // Registered for every compiled run, pins or not: a specifier no runtime can
  // serve is reported from here even when the project declared nothing. Only a
  // pin ever produces a CDN redirect, so the fetching half stays pin-gated.
  const missingDependencies: MissingProjectDependency[] = [];
  if (compiled) {
    plugins.push(
      createProjectDependencyCdnPlugin(dependencyPins, (specifier, reason) => {
        missingDependencies.push({ specifier, reason });
      }),
    );
    if (Object.keys(dependencyPins).length > 0) {
      plugins.push(createHTTPPlugin({ fetchFn: fetchProjectDependencySource }));
    }
  }

  let result: Awaited<ReturnType<typeof build>>;
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
  } catch (error) {
    throw classifyBundleFailure(error, paths, missingDependencies);
  }

  if (result.errors.length > 0) {
    // Defensive: the bundler wrapper rejects rather than returning errors, so
    // this path is not the one classification normally arrives through.
    throw classifyBundleFailure(result, paths, missingDependencies);
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
        detail: `${paths.display} imports "${unresolvable}", which this runtime cannot resolve. ` +
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
  clearDependencySourceCache();
}
