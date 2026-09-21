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
  embeddedConstraintForBareImport,
  embeddedConstraintForVersion,
  isFrameworkProvidedPackage,
  nodeBuiltinSpecifier,
  parseNpmSpecifier,
  rangeAdmitsVersion,
} from "./project-npm-imports.ts";
import { createHTTPPlugin } from "#veryfront/transforms/esm/http-bundler.ts";
import { readHttpModuleText } from "#veryfront/transforms/shared/http-module-response.ts";
import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { ESM_CDN_BASE } from "#veryfront/utils/constants/cdn.ts";
import { guardedOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import {
  COMPILATION_ERROR,
  DEPENDENCY_MISSING,
  FILE_NOT_FOUND,
  VeryfrontError,
} from "#veryfront/errors";
import { wrapWithCurrentContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { getDiscoveryRuntimeModules } from "./runtime-modules.ts";
import { isExplicitHostProjectCodeExecutionAllowed } from "#veryfront/security/project-locality.ts";
import { LOCKFILE_CLIENTS, type PackageClient } from "#veryfront/utils/package-client.ts";

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
  // Later groups override earlier ones, in the order npm's own resolver loads
  // them (`Node#loadDeps` in @npmcli/arborist): peers first, then production,
  // then optional, and the root project's dev dependencies last. Each later
  // edge replaces the one before it, so a package declared twice resolves to
  // its LAST group -- which is why `devDependencies` has to follow
  // `optionalDependencies` here and not precede it.
  const groups = [
    pkg?.peerDependencies,
    pkg?.dependencies,
    pkg?.optionalDependencies,
    pkg?.devDependencies,
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

/**
 * The public npm registry, the only source a project dependency may be
 * inlined from.
 *
 * esm.sh serves the PUBLIC package of a given name, so inlining one is only
 * the project's own dependency when the project itself resolves that name
 * from the public registry. A project on a private registry can hold a
 * package whose name and version also exist publicly, and serving the public
 * copy would run a stranger's code inside the project's runtime. The
 * lockfile's `resolved` URL is what says which registry the project actually
 * installed from, so it is required, and anything else fails closed.
 */
const PUBLIC_NPM_REGISTRY = "https://registry.npmjs.org/";

/** The host that serves it, for a `resolved` value written another way. */
const PUBLIC_NPM_REGISTRY_HOST = new URL(PUBLIC_NPM_REGISTRY).hostname;

/** What a project's lockfile resolved for one package. */
interface LockedDependency {
  version: string;
  /**
   * The entry's `resolved` value, or `null` when it has none. npm's
   * `omit-lockfile-registry-resolved` deliberately writes registry entries
   * without one, so absence is not by itself evidence of a private source --
   * it moves the question to the effective registry the `.npmrc` names.
   */
  resolved: string | null;
  /** The ranges this package itself declares, by name. */
  dependencies: Readonly<Record<string, string>>;
}

/** The dependency ranges one lockfile entry declares, whatever its format. */
function lockedEntryDependencies(entry: Record<string, unknown>): Record<string, string> {
  const ranges: Record<string, string> = {};
  // v2/v3 entries carry the package's own manifest fields; a v1 entry records
  // the same edges under `requires`.
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "requires"]) {
    const group = entry[field];
    if (!group || typeof group !== "object") continue;
    for (const [name, range] of Object.entries(group as Record<string, unknown>)) {
      if (name === "__proto__" || typeof range !== "string") continue;
      ranges[name] = range;
    }
  }
  return ranges;
}

/** A path key and the entry it addresses, keyed the way v2/v3 locks are. */
function addLockedEntry(
  locked: Record<string, LockedDependency>,
  path: string,
  entry: Record<string, unknown>,
): void {
  // Keyed by the install path, so a workspace member's own copy
  // (`packages/app/node_modules/pkg`) stays distinct from the hoisted one.
  if (path === "__proto__" || !/(?:^|\/)node_modules\//.test(path)) return;
  const { version, resolved } = entry as { version?: unknown; resolved?: unknown };
  if (typeof version !== "string") return;
  locked[path] = {
    version,
    resolved: typeof resolved === "string" ? resolved : null,
    dependencies: lockedEntryDependencies(entry),
  };
}

/**
 * The v1 (`npm` 5 and 6) lockfile's hierarchical `dependencies` tree, read
 * into the same install-path keys a v2/v3 `packages` table uses: a nested
 * entry lives under its parent's own `node_modules`.
 */
function readV1LockedDependencies(
  tree: Record<string, unknown>,
  prefix: string,
  locked: Record<string, LockedDependency>,
): void {
  for (const [name, entry] of Object.entries(tree)) {
    if (name === "__proto__" || !entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const path = `${prefix}node_modules/${name}`;
    addLockedEntry(locked, path, record);
    const nested = record.dependencies;
    // A v1 entry's `dependencies` is its nested install tree, not its ranges;
    // `requires` holds those, which is why both are read for the edges.
    if (nested && typeof nested === "object") {
      readV1LockedDependencies(nested as Record<string, unknown>, `${path}/`, locked);
    }
  }
}

/**
 * `install path -> {version, resolved, dependencies}` from a project's npm
 * lockfile.
 *
 * Both formats npm has written are read. A v2/v3 lock keys every install path
 * under `packages`; a v1 lock -- still what an npm 5 or 6 project carries, and
 * still what `npm install --lockfile-version=1` writes -- nests its entries
 * under `dependencies` instead. Reading only `packages` left every declared
 * dependency of such a project unvouched for, so discovery refused all of
 * them with "the lockfile does not resolve <pkg>" while usable provenance sat
 * in the file.
 *
 * @internal Exported for testing only.
 */
export function readLockedDependencies(lockText: string): Record<string, LockedDependency> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lockText);
  } catch (_) {
    /* expected: a project may ship an unparseable or absent lockfile */
    return {};
  }
  const locked: Record<string, LockedDependency> = {};
  const { packages, dependencies } = (parsed ?? {}) as {
    packages?: unknown;
    dependencies?: unknown;
  };
  if (packages && typeof packages === "object") {
    for (const [path, entry] of Object.entries(packages as Record<string, unknown>)) {
      if (entry && typeof entry === "object") {
        addLockedEntry(locked, path, entry as Record<string, unknown>);
      }
    }
    return locked;
  }
  if (dependencies && typeof dependencies === "object") {
    readV1LockedDependencies(dependencies as Record<string, unknown>, "", locked);
  }
  return locked;
}

/**
 * What the lockfile resolved for `name` as this project sees it: the member's
 * own copy first, then the one hoisted to the lock's directory. npm installs a
 * member-specific version beside the hoisted one when they differ.
 */
function lockedDependency(
  sources: ProjectRegistrySources,
  name: string,
): { path: string; entry: LockedDependency } | undefined {
  const paths = sources.memberPath.length > 0
    ? [`${sources.memberPath}/node_modules/${name}`, `node_modules/${name}`]
    : [`node_modules/${name}`];
  for (const path of paths) {
    if (Object.hasOwn(sources.locked, path)) return { path, entry: sources.locked[path]! };
  }
  return undefined;
}

/**
 * The lock entry a package installed at `fromPath` reaches for `name`, found
 * the way Node resolution finds it: the installer's own `node_modules` first,
 * then each enclosing one out to the lockfile's root.
 */
function lockedDependencyFrom(
  locked: Readonly<Record<string, LockedDependency>>,
  fromPath: string,
  name: string,
): { path: string; entry: LockedDependency } | undefined {
  let prefix = fromPath;
  for (;;) {
    const candidate = prefix.length === 0
      ? `node_modules/${name}`
      : `${prefix}/node_modules/${name}`;
    if (Object.hasOwn(locked, candidate)) return { path: candidate, entry: locked[candidate]! };
    if (prefix.length === 0) return undefined;
    const enclosing = prefix.lastIndexOf("/node_modules/");
    prefix = enclosing < 0 ? "" : prefix.slice(0, enclosing);
  }
}

/**
 * One `.npmrc` read the way npm's INI parser reads it: the LAST value of each
 * key, comments stripped, and surrounding quotes removed. A key written on its
 * own is INI's `true`.
 */
function readNpmrc(npmrcText: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of npmrcText.split("\n")) {
    // An unescaped `#` or `;` starts a comment wherever it appears, so a
    // mirror with a trailing note still applies.
    const statement = line.replace(/(?<!\\)[#;].*$/, "").trim();
    // A section header addresses no key this reads.
    if (statement.length === 0 || statement.startsWith("[")) continue;
    const separator = statement.indexOf("=");
    const key = (separator < 0 ? statement : statement.slice(0, separator)).trim();
    if (key.length === 0) continue;
    const raw = separator < 0 ? "true" : statement.slice(separator + 1).trim();
    // npm's INI parser strips a matching pair of quotes, so
    // `registry="https://registry.npmjs.org/"` names the public registry;
    // keeping the quotes read it as a redirect and refused every dependency.
    const unquoted = /^"(.*)"$/.exec(raw)?.[1] ?? /^'(.*)'$/.exec(raw)?.[1] ?? raw;
    values.set(key, unquoted);
  }
  return values;
}

/**
 * The registry one `.npmrc` installs `name` from, or `undefined` when it names
 * none. A package's `@scope:registry` takes precedence over the default one.
 *
 * @internal Exported for testing only.
 */
export function npmrcRegistryFor(npmrcText: string, name: string): string | undefined {
  const values = readNpmrc(npmrcText);
  const scope = name.startsWith("@") ? name.slice(0, name.indexOf("/")) : null;
  const effective = (scope === null ? undefined : values.get(`${scope}:registry`)) ??
    values.get("registry");
  return effective === undefined ? undefined : effective.replace(/\/*$/, "/");
}

/**
 * Does `.npmrc` point this package's installs somewhere other than the public
 * registry? A `registry=` line, or a `@scope:registry=` for the package's own
 * scope, means the project's copy is not the public one.
 *
 * @internal Exported for testing only.
 */
export function npmrcRedirectsPackage(npmrcText: string, name: string): boolean {
  const effective = npmrcRegistryFor(npmrcText, name);
  return effective !== undefined && effective !== PUBLIC_NPM_REGISTRY;
}

/**
 * Does `.npmrc` turn on npm's `omit-lockfile-registry-resolved`? Registry
 * entries then keep their version and integrity but carry no `resolved` URL,
 * and this setting is the only record that their absence was deliberate.
 */
function npmrcOmitsResolved(npmrcText: string): boolean {
  return readNpmrc(npmrcText).get("omit-lockfile-registry-resolved") === "true";
}

/** The coordinate to fetch, or why nothing may be fetched for this import. */
type CdnSourceDecision =
  | {
    version: string;
    /** `name@version` for every package the CDN build must also resolve. */
    dependencyPins?: readonly string[];
  }
  | { refusal: string };

/** Does any `.npmrc` that applies to this project redirect `name`? */
function npmrcRedirects(sources: ProjectRegistrySources, name: string): boolean {
  // npm ignores a workspace member's own file when the root owns the install,
  // so the member's may not VOUCH for the public registry -- but a member
  // naming a private one is still evidence against the public copy, and this
  // decision only ever fails closed on it.
  return npmrcRedirectsPackage(sources.npmrc, name) ||
    npmrcRedirectsPackage(sources.memberNpmrc, name);
}

/**
 * Is this lock entry's package the one the public registry serves?
 *
 * npm writes the tarball URL for a registry source, but two supported
 * configurations write something else: the documented registry-RELATIVE form
 * (`registry.npmjs.org/yaml/-/yaml-2.9.0.tgz`, or a bare path), and
 * `omit-lockfile-registry-resolved`, which writes no `resolved` at all. In
 * both the project's own `.npmrc` is what names the registry, so it has to
 * select the public one explicitly; silence is not evidence.
 */
function resolvesFromPublicRegistry(
  sources: ProjectRegistrySources,
  entry: LockedDependency,
  name: string,
): boolean {
  if (npmrcRedirects(sources, name)) return false;
  const configured = npmrcRegistryFor(sources.npmrc, name) === PUBLIC_NPM_REGISTRY;
  if (entry.resolved === null) return npmrcOmitsResolved(sources.npmrc) && configured;
  let url: URL;
  try {
    url = new URL(entry.resolved);
  } catch (_) {
    /* expected: npm documents `resolved` as a path relative to the registry */
    return configured;
  }
  // A `git+ssh:`, `file:` or `link:` source is not a registry package at all.
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return url.hostname.toLowerCase() === PUBLIC_NPM_REGISTRY_HOST;
}

/**
 * How far the transitive walk goes before the graph is called unverifiable.
 * A bound is needed because the walk is over project-supplied data; the deepest
 * real closure this has to serve is far below it.
 */
const MAX_TRANSITIVE_LOCKED_DEPENDENCIES = 512;

/**
 * Every package the CDN has to resolve underneath `name`, pinned to the
 * version the project's lockfile installed -- or why the project's own
 * evidence does not cover them.
 *
 * The CDN is handed one coordinate and resolves that package's dependency
 * RANGES itself, against the public registry, at build time. Left alone it
 * therefore picks versions the project never installed, and -- the reason this
 * fails closed -- it serves the PUBLIC package for a transitive name the
 * project resolves from a private registry. Walking the lockfile turns the
 * project's own install into an exact, verified pin list for the build.
 */
function transitiveLockedDependencies(
  sources: ProjectRegistrySources,
  rootPath: string,
  rootName: string,
): { pins: string[] } | { refusal: string } {
  const pinned = new Map<string, string>();
  // A name the lockfile installs at two versions at once. esm.sh resolves one
  // version per name for a build, so such a name cannot be pinned; it is only
  // ever dropped, never guessed at.
  const nested = new Set<string>();
  const visited = new Set<string>([rootPath]);
  const queue: string[] = [rootPath];
  while (queue.length > 0) {
    const path = queue.shift()!;
    for (const dependency of Object.keys(sources.locked[path]!.dependencies)) {
      const found = lockedDependencyFrom(sources.locked, path, dependency);
      // A name the lockfile does not carry at all is one the project never
      // installed -- an optional dependency skipped on this platform, or a
      // peer the host supplies -- so the project holds no copy for a public
      // one to stand in for. It is left to the CDN, as `npm install` would
      // have left it to the registry.
      if (found === undefined) continue;
      // Present and private is the substitution this refuses: the project's
      // own copy of that name is not the one esm.sh would serve.
      if (!resolvesFromPublicRegistry(sources, found.entry, dependency)) {
        return {
          refusal: `the project resolves ${dependency}, which ${rootName} depends on, from ` +
            `another registry, so the CDN build of ${rootName} would carry the public package ` +
            `of that name instead of this project's`,
        };
      }
      if (pinned.get(dependency) !== found.entry.version) {
        if (pinned.has(dependency)) nested.add(dependency);
        pinned.set(dependency, found.entry.version);
      }
      if (pinned.size > MAX_TRANSITIVE_LOCKED_DEPENDENCIES) {
        return {
          refusal: `the project's lockfile puts more than ` +
            `${MAX_TRANSITIVE_LOCKED_DEPENDENCIES} packages under ${rootName}, too many to ` +
            `pin the CDN build to`,
        };
      }
      if (!visited.has(found.path)) {
        visited.add(found.path);
        queue.push(found.path);
      }
    }
  }
  const pins = [...pinned]
    .filter(([name]) => !nested.has(name))
    .map(([name, version]) => `${name}@${version}`);
  return { pins: pins.sort() };
}

/**
 * Which version of `name` the CDN may serve, or why none may be.
 *
 * The project's lockfile is both the provenance evidence and the version of
 * record: `npm install` writes a range and the lock moves ahead of its lower
 * bound, so the locked version -- not the range's lower bound -- is the one
 * the project installed. It is served only when the declaration and the
 * import's own range both admit it. Failing closed is the point: without that
 * evidence the CDN copy is a package of the same name, not this project's
 * dependency.
 */
function cdnSourceDecision(
  sources: ProjectRegistrySources,
  declared: string | undefined,
  name: string,
  named: string,
  importRange: string | null,
): CdnSourceDecision {
  if (sources.unverifiableClient !== null) {
    return {
      refusal: `the project's ${sources.unverifiableClient} lockfile owns its dependencies and ` +
        `does not record which registry each came from, so the public package of that name ` +
        `cannot be shown to be this project's dependency`,
    };
  }
  if (npmrcRedirects(sources, name)) {
    return {
      refusal: `the project's .npmrc installs ${name} from another registry, so the public ` +
        `package of that name is not this project's dependency`,
    };
  }
  const locked = lockedDependency(sources, name);
  if (locked === undefined) {
    return {
      refusal: `the project's lockfile does not resolve ${name}, so the public package of ` +
        `that name cannot be shown to be this project's dependency -- commit a ` +
        `package-lock.json`,
    };
  }
  if (!resolvesFromPublicRegistry(sources, locked.entry, name)) {
    return {
      refusal: `the project's lockfile resolves ${name} from another registry, so the public ` +
        `package of that name is not this project's dependency`,
    };
  }
  const admits = (range: string | null | undefined) =>
    range === null || range === undefined ||
    rangeAdmitsVersion(range, locked.entry.version) === true;
  if (locked.entry.version !== named && !(admits(declared) && admits(importRange))) {
    return {
      refusal: `the project's lockfile resolves a version of ${name} that the project's own ` +
        `declaration or this import does not admit`,
    };
  }
  // The direct package is vouched for; everything it pulls in has to be too,
  // because the CDN resolves those ranges itself.
  const transitive = transitiveLockedDependencies(sources, locked.path, name);
  if ("refusal" in transitive) return transitive;
  return { version: locked.entry.version, dependencyPins: transitive.pins };
}

/** The version the lockfile resolved for each declared package, by name. */
function lockedVersionsByName(
  sources: ProjectRegistrySources,
  pins: Readonly<Record<string, string>>,
): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const name of Object.keys(pins)) {
    const locked = lockedDependency(sources, name);
    if (locked !== undefined) versions[name] = locked.entry.version;
  }
  return versions;
}

/**
 * The declared packages the project's own lockfile vouches for: resolved from
 * the public registry, with no `.npmrc` sending them elsewhere. Only these may
 * reuse the binary's embedded copy, which is the FRAMEWORK's artifact.
 */
function publiclySourcedPackages(
  sources: ProjectRegistrySources,
  pins: Readonly<Record<string, string>>,
): ReadonlySet<string> {
  const publicly = new Set<string>();
  if (sources.unverifiableClient !== null) return publicly;
  for (const name of Object.keys(pins)) {
    const locked = lockedDependency(sources, name);
    if (locked !== undefined && resolvesFromPublicRegistry(sources, locked.entry, name)) {
      publicly.add(name);
    }
  }
  return publicly;
}

/** A project's evidence for where its dependencies come from. */
interface ProjectRegistrySources {
  locked: Record<string, LockedDependency>;
  /**
   * The `.npmrc` npm actually reads for this project: the one beside the
   * lockfile that owns it. For a workspace member that is the ROOT's file --
   * npm reports that it ignores a member's own workspace config, so merging
   * the two let a member's `@scope:registry` override the root's `registry`
   * and vouch for the public copy of a privately resolved package.
   */
  npmrc: string;
  /**
   * A workspace member's own `.npmrc`, kept apart because it may only ever
   * veto: see {@link npmrcRedirects}. Empty when the project owns its lock.
   */
  memberNpmrc: string;
  /** The project's path inside the lockfile's directory; empty when it owns it. */
  memberPath: string;
  /**
   * The client whose lockfile owns the project, when it is not npm's. Only an
   * npm lockfile records a `resolved` URL per package, so any other owner
   * leaves provenance unverifiable and nothing may be inlined.
   */
  unverifiableClient: PackageClient | null;
}

async function readProjectFile(context: FileDiscoveryContext, path: string): Promise<string> {
  try {
    return context.fsAdapter
      ? await context.fsAdapter.readFile(path)
      : await createFileSystem().readTextFile(path);
  } catch (_) {
    /* expected: a project may ship neither file */
    return "";
  }
}

/** How far up a workspace a member's lockfile may live. */
const MAX_WORKSPACE_ANCESTORS = 8;

/**
 * The directories a lockfile for this project may live in: its own, then its
 * workspace ancestors. An npm workspace keeps one lockfile at the root while
 * each member has its own package.json, so stopping at `baseDir` would report
 * every dependency of a member as unvouched for.
 */
function projectLockDirectories(baseDir: string | undefined): string[] {
  const root = portableRoot(baseDir ?? ".");
  const directories = [root.length === 0 ? "." : root];
  // A relative base (a hosted VFS) addresses the project root itself, so it
  // has no ancestors to search.
  if (!isAbsoluteMachinePath(directories[0]!)) return directories;
  for (let depth = 0; depth < MAX_WORKSPACE_ANCESTORS; depth++) {
    const parent = pathHelper.dirname(directories[directories.length - 1]!);
    if (parent === directories[directories.length - 1]) break;
    directories.push(parent);
  }
  return directories;
}

/**
 * Does the package.json at a workspace root declare `member` (a path relative
 * to that root) as one of its workspaces? A project merely nested under
 * another is not a member, and that project's lockfile says nothing about it.
 */
function declaresWorkspaceMember(rootPackageJson: string, member: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rootPackageJson);
  } catch (_) {
    /* expected: an ancestor may ship an unparseable package.json */
    return false;
  }
  const declared = (parsed as { workspaces?: unknown })?.workspaces;
  const patterns = Array.isArray(declared)
    ? declared
    : (declared as { packages?: unknown })?.packages;
  if (!Array.isArray(patterns)) return false;
  const segments = member.split("/");
  let matched = false;
  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    const negated = pattern.startsWith("!");
    const normalized = normalizeWorkspacePattern(negated ? pattern.slice(1) : pattern);
    if (normalized.length === 0) continue;
    if (!matchesWorkspacePattern(normalized.split("/"), segments)) continue;
    // A negated pattern removes what the positive ones matched, wherever it
    // is written, which is how `["packages/*", "!packages/private"]` reads.
    if (negated) return false;
    matched = true;
  }
  return matched;
}

/** A workspace pattern without its `./` prefix or its trailing separators. */
function normalizeWorkspacePattern(pattern: string): string {
  return pattern.replace(/^\.\/+/, "").replace(/\/+$/, "");
}

/**
 * Does a workspace glob match a member path, segment by segment? npm matches
 * these with minimatch, so `*` stands for part of one segment and `**` for any
 * number of them: `packages/*`, `./packages/*`, `packages/**` and `apps/*-web`
 * are all patterns npm accepts and all name real members.
 *
 * Written as two pointer walks rather than a generated RegExp: the pattern is
 * project text, and a `**`-heavy one compiled to a regular expression is the
 * shape that backtracks exponentially.
 */
function matchesWorkspacePattern(
  pattern: readonly string[],
  member: readonly string[],
): boolean {
  let p = 0;
  let m = 0;
  let star = -1;
  let matchedTo = 0;
  while (m < member.length) {
    if (p < pattern.length && pattern[p] === "**") {
      star = p++;
      matchedTo = m;
    } else if (p < pattern.length && matchesSegment(pattern[p]!, member[m]!)) {
      p++;
      m++;
    } else if (star < 0) {
      return false;
    } else {
      // Give the last `**` one more segment and retry from just after it.
      p = star + 1;
      m = ++matchedTo;
    }
  }
  while (p < pattern.length && pattern[p] === "**") p++;
  return p === pattern.length;
}

/** Does one pattern segment, with `*` standing for any run of characters, match? */
function matchesSegment(pattern: string, name: string): boolean {
  let p = 0;
  let n = 0;
  let star = -1;
  let matchedTo = 0;
  while (n < name.length) {
    if (p < pattern.length && pattern[p] === "*") {
      star = p++;
      matchedTo = n;
    } else if (p < pattern.length && pattern[p] === name[n]) {
      p++;
      n++;
    } else if (star < 0) {
      return false;
    } else {
      p = star + 1;
      n = ++matchedTo;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

async function readProjectRegistrySources(
  context: FileDiscoveryContext,
): Promise<ProjectRegistrySources> {
  const directories = projectLockDirectories(context.baseDir);
  const project = directories[0]!;
  const npmrcOf = (directory: string) =>
    readProjectFile(context, pathHelper.join(directory, ".npmrc"));
  // Every directory that speaks for this project: its own, and each ancestor
  // that declares it a workspace member. A project merely nested under another
  // is not a member, and that project's lockfile says nothing about it.
  const owners: { directory: string; memberPath: string }[] = [];
  for (const directory of directories) {
    const memberPath = directory === project
      ? ""
      : project.slice(directory.length).replace(/^\/+/, "");
    if (
      memberPath.length > 0 &&
      !declaresWorkspaceMember(
        await readProjectFile(context, pathHelper.join(directory, "package.json")),
        memberPath,
      )
    ) {
      continue;
    }
    owners.push({ directory, memberPath });
  }
  // The OUTERMOST of them owns the install: every workspace client keeps one
  // lockfile at the root and none in the members, so a lock beside a member is
  // a leftover from before it joined. Taking the nearest one instead let a
  // stale `package-lock.json` in a pnpm or Yarn member outrank the root's
  // authoritative lockfile, and with it decide provenance.
  for (const { directory, memberPath } of owners.reverse()) {
    // npm reads the config beside the lockfile it is resolving; a member's own
    // file is reported as ignored, so it is carried separately.
    const npmrc = await npmrcOf(directory);
    const memberNpmrc = memberPath.length === 0 ? "" : await npmrcOf(project);
    const shrinkwrapOf = (at: string) =>
      readProjectFile(context, pathHelper.join(at, "npm-shrinkwrap.json"));
    // Within one directory the repo's own precedence decides: the lockfile a
    // client wrote owns the project, and an npm lock inherited from a
    // migration must not outrank it.
    for (const [file, client] of LOCKFILE_CLIENTS) {
      const text = await readProjectFile(context, pathHelper.join(directory, file));
      if (text.length === 0) continue;
      if (client !== "npm") {
        return { locked: {}, npmrc, memberNpmrc, memberPath, unverifiableClient: client };
      }
      // npm ignores package-lock.json entirely when a shrinkwrap is present.
      const shrinkwrap = await shrinkwrapOf(directory);
      return {
        locked: readLockedDependencies(shrinkwrap || text),
        npmrc,
        memberNpmrc,
        memberPath,
        unverifiableClient: null,
      };
    }
    const shrinkwrap = await shrinkwrapOf(directory);
    if (shrinkwrap.length > 0) {
      return {
        locked: readLockedDependencies(shrinkwrap),
        npmrc,
        memberNpmrc,
        memberPath,
        unverifiableClient: null,
      };
    }
  }
  return {
    locked: {},
    npmrc: await npmrcOf(project),
    memberNpmrc: "",
    memberPath: "",
    unverifiableClient: null,
  };
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
function parseEsmCdnModule(url: URL): { name: string; version: string; subpath: string } | null {
  if (url.origin !== ESM_CDN_ORIGIN) return null;
  const segments = url.pathname.replace(/^\/(?:v\d+|stable)\//, "/").split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const scoped = segments[0]!.startsWith("@") && segments.length > 1;
  const pinned = scoped ? `${segments[0]}/${segments[1]}` : segments[0]!;
  // The package's own `@` is the first one after any scope: an npm name holds
  // no other. Reading the LAST one instead mis-parsed esm.sh's peer-qualified
  // builds -- `react-dom@18.3.1_react@18.3.1` became the package
  // `react-dom@18.3.1_react`, which the framework-identity guard then missed,
  // bundling a second React alongside the framework's own.
  const separator = pinned.indexOf("@", scoped ? pinned.indexOf("/") + 1 : 0);
  const name = separator < 0 ? pinned : pinned.slice(0, separator);
  if (name.length === 0) return null;
  // esm.sh appends the peers it built against after an underscore, a character
  // no semver version may contain, so that is where the version ends.
  const version = separator < 0 ? "" : pinned.slice(separator + 1).split("_", 1)[0]!;

  let rest = segments.slice(scoped ? 2 : 1);
  if (rest.length > 0 && ESM_CDN_BUILD_OPTIONS.test(rest[0]!)) rest = rest.slice(1);
  if (rest.length > 0 && ESM_CDN_BUILD_TARGET.test(rest[0]!)) rest = rest.slice(1);
  const file = rest.join("/").replace(ESM_CDN_MODULE_EXTENSION, "");
  // esm.sh names the root module after the package, so a file matching the
  // package's own last name segment is the root rather than a subpath.
  const rootModuleName = name.slice(name.lastIndexOf("/") + 1);
  const subpath = file.length === 0 || file === rootModuleName ? "" : file;
  return { name, version, subpath };
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
 * The prefix the deferred module's error carries when it could not reach the
 * registry below, so a `require()` at module scope -- which esbuild reports
 * with the same kind as a lazy one, and which therefore runs as soon as the
 * module is imported -- is still classified rather than escaping unrecognised.
 */
const MISSING_DEPENDENCY_MARKER = "[veryfront:missing-npm-dependency]";

/**
 * The global the bundled module reaches for to build its error.
 *
 * The bundle is standalone JavaScript: it holds no import of the error
 * registry, and the specifier that would reach one is the project's to
 * resolve, not the framework's. Reaching through a global is what keeps the
 * failure TYPED at the moment it is reached -- a handler awaiting a lazy
 * `import()` catches a `dependency-missing` VeryfrontError like any other,
 * instead of a bare Error carrying an internal marker. The module is
 * `import()`ed from this file and so runs in this realm, where the global is
 * always installed; the fallback in the generated source is for a bundle
 * executed anywhere else.
 */
const DEFERRED_DEPENDENCY_ERROR_GLOBAL = "__veryfrontDeferredDependencyError";

/** Marks the errors that factory builds, so a module-scope throw is recognised. */
const DEFERRED_DEPENDENCY_CONTEXT = { veryfrontDeferredDependency: true } as const;

(globalThis as Record<string, unknown>)[DEFERRED_DEPENDENCY_ERROR_GLOBAL] = (detail: string) =>
  DEPENDENCY_MISSING.create({ detail, context: DEFERRED_DEPENDENCY_CONTEXT });

/** The statements a bundled module runs to fail with `detail` when reached. */
function deferredDependencyThrow(detail: string): string {
  const create = JSON.stringify(DEFERRED_DEPENDENCY_ERROR_GLOBAL);
  return `const create = globalThis[${create}]; ` +
    `throw typeof create === "function" ? create(${JSON.stringify(detail)}) : ` +
    `new Error(${JSON.stringify(`${MISSING_DEPENDENCY_MARKER} ${detail}`)});`;
}

/**
 * The detail a deferred dependency failure carries, or `null` when the error
 * is not one. Both forms the generated module can throw are recognised.
 */
function deferredDependencyDetail(error: unknown): string | null {
  if (
    error instanceof VeryfrontError && error.slug === DEPENDENCY_MISSING.slug &&
    (error.context as { veryfrontDeferredDependency?: unknown } | undefined)
        ?.veryfrontDeferredDependency === true
  ) {
    return error.detail ?? error.message;
  }
  return error instanceof Error && error.message.startsWith(MISSING_DEPENDENCY_MARKER)
    ? error.message.slice(MISSING_DEPENDENCY_MARKER.length).trim()
    : null;
}

/** The name the emitted module gives the `require.resolve` stand-in. */
const REQUIRE_RESOLVE_HELPER = "__veryfrontRequireResolve";

/**
 * The stand-in itself. It names no specifier: the argument is project text
 * that can carry anything, and the reason is the same for every probe.
 */
function requireResolveHelperSource(): string {
  const detail = `Cannot serve a require.resolve() probe: discovery bundles a project's ` +
    `dependencies at build time, so there is no module path to return. Import the package ` +
    `instead, or move the work to an extension or a sandbox session.`;
  return `function ${REQUIRE_RESOLVE_HELPER}() { ${deferredDependencyThrow(detail)} }`;
}

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
  resolveCdnSource: (
    name: string,
    version: string,
    importRange: string | null,
  ) => CdnSourceDecision = (_name, version) => ({ version }),
  /** The version the project's lockfile resolved for each declared package. */
  locked: Record<string, string> = {},
  /** Declared packages the project's lockfile resolves from the public registry. */
  publiclySourced: ReadonlySet<string> = new Set(),
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
        contents: deferredDependencyThrow(
          typeof args.pluginData === "string" ? args.pluginData : "",
        ),
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
        const specifier = esmCdnModuleSpecifier(url)!;
        // A compiled binary resolves `npm:` by constraint, and some framework
        // packages are recorded only at exact versions (`react-dom`,
        // `@opentelemetry/*`), so the URL's own version is re-emitted when the
        // binary records it. Without one the bare specifier is left as before,
        // which is what an uncompiled run resolves.
        // The URL's own version when the binary records it, otherwise any
        // constraint it records for that package: this plugin runs only on a
        // compiled binary, where a bare `npm:react-dom` resolves to nothing.
        const constraint = (parsed.version.length > 0
          ? embeddedConstraintForVersion(parsed.name, parsed.version)
          : null) ?? embeddedConstraintForBareImport(parsed.name);
        if (constraint === null) {
          return { path: specifier, external: true };
        }
        const tail = specifier.slice(parsed.name.length);
        return { path: `npm:${parsed.name}@${constraint}${tail}`, external: true };
      });

      /**
       * Report an import nothing may serve.
       *
       * A deferred `import()` -- or its CommonJS forms, `require()` and
       * `require.resolve()` -- inside a handler body is the project's own lazy
       * path, and often an optional one behind a try/catch. Failing the bundle
       * for it would delete every unrelated export of the file (tools, agents,
       * schemas) from discovery, a strictly larger blast radius than the
       * failure it replaces, so it is deferred to call time. It is not handed
       * back to the runtime: for an import the project's own declaration
       * contradicts, the runtime could load the very version package.json
       * rules out.
       *
       * A STATIC import is different: nothing can load the module without it,
       * so the file was going to fail either way. Failing here is the same
       * blast radius reported earlier and with a classified reason instead of
       * Deno's raw constraint text.
       */
      const reportMissing = (args: { kind: string }, shown: string, reason: string) => {
        if (
          args.kind === "dynamic-import" || args.kind === "require-call" ||
          args.kind === "require-resolve"
        ) {
          return {
            path: shown,
            namespace: MISSING_DEPENDENCY_NAMESPACE,
            pluginData: `Cannot load "${shown}": ${reason}`,
          };
        }
        onMissing(shown, reason);
        // Stops the build; importModule turns the recorded specifiers into a
        // classified DEPENDENCY_MISSING rather than reading this text back.
        return { errors: [{ text: `Cannot resolve "${shown}": ${reason}` }] };
      };

      build.onResolve({ filter: /^[^./]/ }, (args) => {
        // Imports reached through a fetched module are the HTTP plugin's.
        if (args.namespace === "http-url") return undefined;

        // A bare Node builtin (`crypto`, `fs/promises`) is pinned to its
        // `node:` form here. Left bare it survives into the emitted module,
        // where `rewriteBareNpmImportsForDeno` turns it into `npm:crypto` --
        // an unrelated npm shim package no compiled binary carries.
        const builtin = nodeBuiltinSpecifier(args.path);
        if (builtin) return { path: builtin, external: true };

        const decision = classifyProjectNpmImport(
          args.path,
          pins,
          undefined,
          locked,
          publiclySourced,
        );
        if (decision.kind === "runtime") {
          return decision.specifier === undefined
            ? undefined
            : { path: decision.specifier, external: true };
        }

        if (decision.kind === "missing") {
          // The specifier is project source and can carry a credential
          // (`npm:pkg@https://<TOKEN>@host/x`), so only its redacted form is
          // reported.
          return reportMissing(args, describeNpmImport(args.path), decision.reason);
        }

        const { name, version, subpath } = decision;
        // The CDN serves the PUBLIC package of this name, so it is only this
        // project's dependency when the project resolves it from the public
        // registry -- and the version it locked is the one it installed.
        const source = resolveCdnSource(
          name,
          version,
          parseNpmSpecifier(args.path)?.version ?? null,
        );
        if ("refusal" in source) {
          return reportMissing(args, describeNpmImport(args.path), source.refusal);
        }
        // esm.sh resolves the package's own dependency ranges when it builds,
        // so the versions the project installed are handed to it as `deps`.
        // Without them the build carries whatever the public registry answers
        // with at that moment, which is not what the project locked.
        const pinned = source.dependencyPins ?? [];
        // Percent-encoded, because a version's build metadata carries a `+`
        // that a query parser would otherwise read as a space. The HTTP
        // plugin re-encodes the whole query when it adds its build target, so
        // the CDN sees one normalized form either way.
        const deps = pinned.length === 0 ? "" : `?deps=${pinned.map(encodeURIComponent).join(",")}`;
        return {
          path: `${ESM_CDN_BASE}/${name}@${source.version}${
            subpath === "." ? "" : subpath.slice(1)
          }${deps}`,
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
  // The portable form is what is checked: a native UNC path (`\\\\Server\\Share`)
  // is absolute too, and its server and share are machine layout.
  if (!isAbsoluteMachinePath(file)) return filePath;
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

/**
 * A Windows path -- a volume root (`C:/...`) or a UNC share (`//Server/Share`)
 * -- which Windows compares case-insensitively.
 */
function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith("//");
}

/** Expects the portable form: `/...`, `//Server/Share/...` or `C:/...`. */
function isAbsoluteMachinePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
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
  const underRoot = paths.root.length === 0 ? shown : shown.replace(
    projectRootMention(paths.root),
    (_, separator: string | undefined) => separator === undefined ? "." : "",
  );
  return withoutForeignAbsolutePaths(underRoot);
}

/**
 * An absolute path outside the project root, named by its file alone. The
 * bundler can quote one -- a temp directory, another home directory, a share
 * -- and that layout is no more publishable than the project's own. A URL is
 * left alone: its host is not a filesystem.
 */
function withoutForeignAbsolutePaths(text: string): string {
  // `file://` is a start of its own: a UNC file URL puts the share in the
  // authority (`file://server/share/...`), with no slash after the scheme.
  // A native UNC path starts with two backslashes, the portable form with two
  // slashes, and a file URL with its scheme.
  const start = String.raw`(?:file:\/\/|[A-Za-z]:[\/\\]|\\\\(?=[^\\])|\/\/(?=[^\/])|\/)`;
  const named = (match: string) => pathHelper.basename(toPortablePath(match)) || match;
  // `\\"` inside a quoted path is an escaped delimiter, not the closing one.
  const quoted = new RegExp(String.raw`(["'\`])(${start}(?:\\.|(?!\1)[^\n])*)\1`, "g");
  // Outside quotes the path may not follow a scheme, a host or another path
  // character, and it ends at whitespace or a closing bracket.
  const bare = new RegExp(
    String.raw`(?:file:\/\/|(?<![A-Za-z0-9._~%@:\/\\-])${start})[^\s"'\`)\]]*`,
    "g",
  );
  return text
    // A quoted path runs to ITS OWN closing delimiter: a directory name may
    // carry a space, and a file name may carry the other quote character.
    .replace(quoted, (_match, quote: string, path: string) => `${quote}${named(path)}${quote}`)
    .replace(bare, named);
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
  // A UNC root is an authority in a file URL (`file://server/share/...`), so
  // its two leading separators are absent there but present everywhere else.
  const unc = root.startsWith("//");
  const start = unc
    ? String.raw`(?:file://(?:[/\\]{2})?|(?<![A-Za-z0-9._~%@:/\\-])[/\\]{2})`
    : String.raw`(?:file:///?|(?<![A-Za-z0-9._~%@:/\\-]))`;
  // A filesystem root ends in its separator, so it is a mention only where a
  // path continues after it; the bare `/` of prose is left alone.
  // The two leading separators of a UNC root are matched by `start`.
  const body = escapePath(unc ? root.slice(2) : root);
  const rest = isFilesystemRoot(root)
    ? String.raw`${escapePath(root.slice(0, -1))}([/\\])(?=[A-Za-z0-9._~%-])`
    : String.raw`${body}(?:([/\\])|(?![A-Za-z0-9._~%-]))`;
  return new RegExp(`${start}${rest}`, isWindowsDrivePath(root) ? "gi" : "g");
}

/**
 * A CDN URL in bundler text, with everything the project wrote replaced: the
 * pre-release and build parts of the version, the package subpath, and the
 * query that pins the build's transitive dependencies. The request uses all of
 * it verbatim, but each part is free-form -- semver says nothing about a
 * pre-release's content, a subpath segment is whatever the import named, and
 * the query carries the project's own lockfile coordinates -- so a token in
 * any of them would otherwise reach the classified detail and the bundler's
 * logs through the failing URL.
 */
function withoutCdnProjectText(text: string): string {
  const cdn = ESM_CDN_BASE.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return text.replace(
    new RegExp(
      String
        .raw`(${cdn}/\S*?@\d+(?:\.\d+){0,2})(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?([^\s?]*)(\?\S*)?`,
      "g",
    ),
    (_match, pinned: string, pre?: string, build?: string, subpath?: string, query?: string) =>
      `${pinned}${pre ? "-<redacted>" : ""}${build ? "+<redacted>" : ""}${subpath ? "/..." : ""}${
        query ? "?..." : ""
      }`,
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

  const text = withoutCdnProjectText(withDisplayPath(describeBundleFailure(failure), paths));
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
  // Which registry the project itself installs from decides whether the CDN's
  // copy of a name is its dependency at all.
  const registrySources = compiled && Object.keys(dependencyPins).length > 0
    ? await readProjectRegistrySources(context)
    : { locked: {}, npmrc: "", memberNpmrc: "", memberPath: "", unverifiableClient: null };

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
    registrySources,
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
      createProjectDependencyCdnPlugin(
        dependencyPins,
        (specifier, reason) => {
          missingDependencies.push({ specifier, reason });
        },
        (name, version, importRange) =>
          cdnSourceDecision(
            registrySources,
            Object.hasOwn(dependencyPins, name) ? dependencyPins[name] : undefined,
            name,
            version,
            importRange,
          ),
        lockedVersionsByName(registrySources, dependencyPins),
        publiclySourcedPackages(registrySources, dependencyPins),
      ),
    );
    if (Object.keys(dependencyPins).length > 0) {
      plugins.push(createHTTPPlugin({
        fetchFn: fetchProjectDependencySource,
        describeUrl: withoutCdnProjectText,
      }));
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
      // esbuild leaves `require.resolve` as `__require.resolve`, which the
      // emitted module does not define, so a probe failed with a bare
      // TypeError. Discovery bundles a project's dependencies at build time,
      // so there is no path to return; the probe now fails with a classified
      // reason, at call time for a lazy one exactly like a deferred import.
      define: compiled ? { "require.resolve": REQUIRE_RESOLVE_HELPER } : undefined,
      banner: compiled ? { js: requireResolveHelperSource() } : undefined,
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
      // A deferred import reached at module scope: the reason is already
      // classified, so it is reported rather than rethrown unrecognised.
      const deferred = deferredDependencyDetail(error);
      if (deferred !== null) {
        throw DEPENDENCY_MISSING.create({
          detail: `${paths.display}: ${deferred}. Declare the package in the project's ` +
            `package.json with an exact version and import that same version, or move the ` +
            `work to an extension or a sandbox session.`,
          cause: error,
        });
      }
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
