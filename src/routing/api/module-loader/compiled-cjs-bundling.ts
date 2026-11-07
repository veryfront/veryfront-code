/**
 * CommonJS dependencies of an API route in the compiled binary.
 *
 * A compiled binary cannot load a CommonJS file from disk at runtime: Deno's
 * `require` there reads only the files embedded at compile time, and importing
 * a `.cjs` file evaluates it as ESM. So the route build bundles a project's
 * CommonJS dependencies into the route module itself, and esbuild supplies Node
 * resolution and interop. These pieces keep the bundled code runnable:
 *
 * - A `require()` of a built-in stays external. esbuild emits it as a call to
 *   the module's free `require`, which {@link prependRuntimeRequire} binds to
 *   built-ins imported statically, so nothing loads `node:module` at runtime.
 * - {@link prepareCommonJSFile} parses each dependency file once. A CommonJS
 *   file gets `__dirname` and `__filename` as constants wherever it reads them
 *   unbound, and each `require.resolve("literal")` becomes the path Node would
 *   return. What is left for runtime, a computed `require()` or
 *   `require.resolve()`, gets built-ins, existing project paths and JSON files;
 *   anything else throws `MODULE_NOT_FOUND`.
 * - Inside dependencies, an extensionless `require()` prefers the file Node
 *   would load ({@link createDependencyResolvePlugin}), not a TypeScript
 *   sibling the project's own resolution would pick.
 * - A native addon cannot be bundled or loaded; the build rejects it with a
 *   clear message rather than an esbuild loader error.
 *
 * @module routing/api/module-loader/compiled-cjs-bundling
 */
import { builtinModules } from "node:module";
import { build as bundle, transform } from "veryfront/extensions/bundler";
import type { Plugin, PluginBuild } from "veryfront/extensions/bundler";
import * as pathHelper from "#veryfront/compat/path";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import {
  parseImports,
  parseMaskedImports,
  replaceSpecifiers,
} from "#veryfront/transforms/esm/lexer.ts";

// Names Node accepts only with the `node:` prefix. A bare `test` is an npm package.
const PREFIX_ONLY_BUILTINS = new Set(["test", "test/reporters", "sqlite", "sea"]);
// Names Node accepts without the prefix.
const BUILTINS = new Set(
  builtinModules
    .map((name) => name.replace(/^node:/, ""))
    .filter((name) => !PREFIX_ONLY_BUILTINS.has(name)),
);

/** The built-in module a specifier names, without its `node:` prefix. */
export function builtinModuleName(specifier: string): string | undefined {
  if (specifier.startsWith("node:")) {
    const name = specifier.slice(5);
    return BUILTINS.has(name) || PREFIX_ONLY_BUILTINS.has(name) ? name : undefined;
  }
  return BUILTINS.has(specifier) ? specifier : undefined;
}

const NATIVE_ADDON = /\.node$/i;

/**
 * `value` as a JavaScript string literal for generated code: JSON, with the
 * characters that could end a surrounding script or line escaped as well.
 */
export function codeString(value: string): string {
  return JSON.stringify(value).replace(
    /[<>\u2028\u2029]/g,
    (character) => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

// Names only the file, never the host path.
function nativeAddonError(path: string) {
  return {
    errors: [{
      text: `Native addons are not supported in API routes: ${
        JSON.stringify(pathHelper.basename(path))
      }`,
    }],
  };
}

/**
 * Keeps built-ins external for the importers `appliesTo` accepts. A
 * `require()` of one keeps its id, for the runtime `require` of
 * {@link prependRuntimeRequire}. A dependency's built-ins must be claimed
 * before the project's import map, which does not apply to it; project code's
 * after it, so that a project can map a built-in name to its own module.
 */
export function createCompiledBuiltinPlugin(appliesTo: (importer: string) => boolean): Plugin {
  return {
    name: "vf-compiled-builtins",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const name = builtinModuleName(args.path);
        if (name === undefined || !appliesTo(args.importer)) return undefined;
        if (args.kind === "require-call") return { path: args.path, external: true };
        return { path: `node:${name}`, external: true };
      });
    },
  };
}

/**
 * Fails the build on a native addon once a path resolves to one: a package
 * whose name ends in `.node` is fine. Must run before any plugin that loads
 * files itself.
 */
export function createNativeAddonPlugin(): Plugin {
  return {
    name: "vf-native-addons",
    setup(build) {
      build.onLoad({ filter: NATIVE_ADDON }, (args) => nativeAddonError(args.path));
    },
  };
}

/**
 * Resolution options of a compiled-binary route build. Bundled packages read
 * the `node` and `module-sync` conditions and `main`, as Node 24 does; Node
 * never reads `module`. `node-addons` stays off, as under Node's `--no-addons`:
 * the compiled binary cannot load a native addon, so a package's universal
 * entry is the one it can run.
 * The extension order serves project code, and
 * {@link createDependencyResolvePlugin} restores Node's order inside packages.
 */
export const COMPILED_RESOLVE_OPTIONS = {
  mainFields: ["main"],
  conditions: ["node", "module-sync"],
  resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
};

/** Whether a path is a regular file on the host. */
export type IsFile = (path: string) => Promise<boolean>;

// Extensions Node's require() tries, in order, for an extensionless path.
const NODE_REQUIRE_EXTENSIONS = [".js", ".json", ".node"];

/**
 * The file Node would load for a relative or absolute import that the bundler
 * resolved to `resolvedPath`. The bundler's extension order serves project
 * code and puts TypeScript first. When it added an extension Node's require()
 * does not try, to the path or to its directory's `index`, Node's own
 * candidates for the same stem win. A path the import named exactly, or one a
 * package's `exports` or `main` chose, is kept.
 */
export async function nodePreferredFile(
  resolvedPath: string,
  specifier: string,
  resolveDir: string,
  isFile: IsFile,
  sep: string = pathHelper.sep,
): Promise<string> {
  specifier = requirePath(specifier, sep);
  const relative = specifier.startsWith("./") || specifier.startsWith("../") ||
    specifier === "." || specifier === ".." || pathHelper.isAbsolute(specifier);
  const extension = pathHelper.extname(resolvedPath);
  // An extensionless path is the file the import named exactly; Node checks it first.
  if (!relative || extension === "" || NODE_REQUIRE_EXTENSIONS.includes(extension)) {
    return resolvedPath;
  }
  const stem = resolvedPath.slice(0, resolvedPath.length - extension.length);
  const named = pathHelper.resolve(resolveDir, specifier);
  if (stem !== named && stem !== pathHelper.join(named, "index")) return resolvedPath;
  for (const candidate of NODE_REQUIRE_EXTENSIONS) {
    if (await isFile(stem + candidate)) return stem + candidate;
  }
  return resolvedPath;
}

const RELATIVE_SPECIFIER = /^(?:\.\.?(?:\/|$)|\/)/;
// Also a Windows path relative to the importer; see requirePath().
const RELATIVE_REQUIRE_FILTER = /^(?:\.\.?(?:[\\/]|$)|\/)/;

/**
 * A `require()` id with Windows separators written as `/` when the host
 * separates paths with a backslash, where Node's require() reads `.\\x` as
 * relative. Elsewhere, and for ES module specifiers, which are URLs, a
 * backslash is part of a name.
 */
export function requirePath(specifier: string, sep: string = pathHelper.sep): string {
  return sep === "\\" && /^\.\.?\\/.test(specifier) ? specifier.replaceAll("\\", "/") : specifier;
}
// A package name: not a path and not a package's own `#import`, which
// resolves from the importer's package. A URL is told apart in the handler
// (the bundler's filters are Go regular expressions, without lookahead).
const BARE_SPECIFIER = /^[^./#]/;
const URL_SPECIFIER = /^[a-z][a-z0-9+.-]*:/i;
const LITERAL_REQUIRE_CALL = /\brequire\s*\(\s*(["'])[^"'\\\n]*\1\s*\)/g;
const IN_NODE_MODULES = /[\\/]node_modules[\\/]/;
const FROM_NODE_MODULES = "vfFromNodeModules";

/**
 * The file Node's require() loads for a relative or absolute extensionless
 * import, when that may differ from the bundler's pick: the path plus `.js`,
 * `.json` or `.node`, or its directory's `index` with one of them. Null when
 * the bundler picks the same file: the path names an existing file exactly,
 * it is a package directory whose `main` decides, or Node finds nothing.
 */
export async function nodeRelativeFile(
  specifier: string,
  resolveDir: string,
  isFile: IsFile,
): Promise<string | null> {
  if (!RELATIVE_SPECIFIER.test(specifier)) return null;
  const base = pathHelper.resolve(resolveDir, specifier);
  if (await isFile(base)) return null;
  for (const extension of NODE_REQUIRE_EXTENSIONS) {
    if (await isFile(base + extension)) return base + extension;
  }
  if (await isFile(pathHelper.join(base, "package.json"))) return null;
  for (const extension of NODE_REQUIRE_EXTENSIONS) {
    const index = pathHelper.join(base, "index" + extension);
    if (await isFile(index)) return index;
  }
  return null;
}

/**
 * Resolves the imports of dependency files the way Node does. The bundler's
 * extension order serves project code and would load a TypeScript sibling
 * first, so relative imports are probed in Node's order, with a few file
 * checks and no second resolution. Package imports of a linked workspace
 * package skip the project's tsconfig `paths`. Must run after
 * {@link createCompiledBuiltinPlugin} and before the project's own resolvers.
 */
export function createDependencyResolvePlugin(
  isDependencyFile: (path: string) => boolean,
  isFile: IsFile,
  sep: string = pathHelper.sep,
): Plugin {
  return {
    name: "vf-dependency-resolve",
    setup(build) {
      // A workspace package linked from node_modules lives outside it, where
      // the bundler would apply the project's tsconfig `paths` to its package
      // imports. Resolving from its own node_modules directory instead looks
      // packages up as Node does, and the bundler applies no tsconfig there.
      build.onResolve({ filter: BARE_SPECIFIER }, async (args) => {
        const data = args.pluginData as Record<string, unknown> | undefined;
        if (data?.[FROM_NODE_MODULES] === true || !build.resolve) return undefined;
        if (!args.importer || !isDependencyFile(args.importer)) return undefined;
        if (
          IN_NODE_MODULES.test(args.importer) || URL_SPECIFIER.test(args.path) ||
          builtinModuleName(args.path) !== undefined
        ) {
          return undefined;
        }
        // The bundler needs a directory that exists; from the nearest
        // `node_modules` it looks further up itself, as Node does.
        let result: Awaited<ReturnType<NonNullable<PluginBuild["resolve"]>>> | undefined;
        let directory = args.resolveDir;
        for (;;) {
          result = await build.resolve(args.path, {
            kind: args.kind,
            importer: args.importer,
            resolveDir: pathHelper.join(directory, "node_modules"),
            pluginData: { [FROM_NODE_MODULES]: true },
          });
          if (!result.errors?.length) break;
          // The bundler looks further up from a `node_modules` that exists.
          // A missing one fails, so the search moves up; one whose copy of
          // the package refuses the id ends it, as in Node.
          if (
            await isFile(
              pathHelper.join(directory, "node_modules", packageName(args.path), "package.json"),
            )
          ) {
            return { errors: result.errors };
          }
          const parent = pathHelper.dirname(directory);
          if (parent === directory) return { errors: result.errors };
          directory = parent;
        }
        return {
          path: result.path,
          external: result.external,
          namespace: result.namespace,
          suffix: result.suffix,
          sideEffects: result.sideEffects,
          pluginData: result.pluginData,
        };
      });
      build.onResolve({ filter: RELATIVE_REQUIRE_FILTER }, async (args) => {
        if (!args.importer || !isDependencyFile(args.importer)) return undefined;
        const required = args.kind === "require-call" || args.kind === "require-resolve";
        const path = required ? requirePath(args.path, sep) : args.path;
        if (!RELATIVE_SPECIFIER.test(path)) return undefined;
        const file = await nodeRelativeFile(path, args.resolveDir, isFile);
        if (file !== null) return { path: file };
        if (path === args.path || !build.resolve) return undefined;
        // The bundler reads `.\\x` as a package name; it resolves the path.
        const data = args.pluginData as Record<string, unknown> | undefined;
        if (data?.[RESOLVING_WINDOWS_PATH] === true) return undefined;
        const result = await build.resolve(path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          pluginData: { [RESOLVING_WINDOWS_PATH]: true },
        });
        if (result.errors?.length) return { errors: result.errors };
        return {
          path: result.path,
          external: result.external,
          namespace: result.namespace,
          suffix: result.suffix,
          sideEffects: result.sideEffects,
          pluginData: result.pluginData,
        };
      });
    },
  };
}

/** How {@link createImportExternalsPlugin} tells a nested copy of a package apart. */
export interface ImportExternalsOptions {
  /** Whether an importer is an installed dependency file. */
  readonly isDependencyFile: (path: string) => boolean;
  /** The project's top-level `node_modules` directories, as given and canonical. */
  readonly nodeModules: readonly string[];
  /** A path with symlinks followed, or null when it does not exist. */
  readonly realPath: (path: string) => Promise<string | null>;
}

/**
 * Keeps the given packages external for `import` and `import()` only. A
 * package that loads from disk as ESM may also export CommonJS to `require`;
 * a `require()` of it from a bundled dependency bundles that CommonJS entry,
 * since the runtime `require` cannot load packages. With `options`, an import
 * from a dependency stays external only if it resolves to the project's
 * top-level copy; a nested copy the dependency holds is bundled instead.
 * Must run where esbuild's own resolution would apply: after the project's
 * import map and aliases.
 */
export function createImportExternalsPlugin(
  names: Iterable<string>,
  options?: ImportExternalsOptions,
): Plugin {
  const escaped = [...names].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const filter = new RegExp(`^(?:${escaped.join("|")})(?:/.*)?$`);
  // The real directory of each top-level package, which the external import
  // loads at runtime.
  type Copy = { readonly logical: string; readonly real: string };
  const topLevel = new Map<string, Promise<Copy[]>>();
  const topLevelDirectories = (name: string) => {
    let directories = topLevel.get(name);
    if (directories === undefined) {
      directories = Promise.all(
        (options?.nodeModules ?? []).map(async (root) => {
          const logical = pathHelper.join(root, name);
          const real = await options!.realPath(logical);
          return real === null ? null : { logical, real };
        }),
      ).then((copies) => copies.filter((copy): copy is Copy => copy !== null));
      topLevel.set(name, directories);
    }
    return directories;
  };
  return {
    name: "vf-import-externals",
    setup(build) {
      if (escaped.length === 0) return;
      build.onResolve({ filter }, async (args) => {
        if (args.kind !== "import-statement" && args.kind !== "dynamic-import") return undefined;
        const data = args.pluginData as Record<string, unknown> | undefined;
        if (data?.[RESOLVING_EXTERNAL] === true) return undefined;
        const external = { path: args.path, external: true };
        // A dependency may hold its own copy in a nested node_modules, which
        // Node loads for it instead of the project's.
        if (
          !options || !build.resolve || !args.importer || !options.isDependencyFile(args.importer)
        ) {
          return external;
        }
        const result = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          pluginData: { [RESOLVING_EXTERNAL]: true },
        });
        // The nearest copy refusing the path is Node's answer, even if the
        // project's copy would serve it.
        if (result.errors?.length) return { errors: result.errors };
        if (!result.path || result.external) return external;
        const name = packageName(args.path);
        const real = (await options.realPath(result.path)) ?? result.path;
        const copy = (await topLevelDirectories(name)).find((directory) =>
          isWithinDirectory(directory.real, real)
        );
        if (copy !== undefined) {
          // The import rewrite maps a subpath onto the package directory as
          // written; the file this one resolved to honours the package's
          // `exports`, so the import names it.
          if (args.path === name) return external;
          const file = pathHelper.join(copy.logical, pathHelper.relative(copy.real, real));
          // A target's query or fragment is part of the module's URL, as in Node.
          return { path: pathHelper.toFileUrl(file).href + (result.suffix ?? ""), external: true };
        }
        return {
          path: result.path,
          namespace: result.namespace,
          suffix: result.suffix,
          sideEffects: result.sideEffects,
          pluginData: result.pluginData,
        };
      });
    },
  };
}

// The package a bare specifier names: its first segment, or two when scoped.
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return parts.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

const RESOLVING_EXTERNAL = "vfResolvingExternal";
const RESOLVING_WINDOWS_PATH = "vfResolvingWindowsPath";

/** Reads a package.json as text, or null when the directory has none. */
export type ReadManifest = (path: string) => Promise<string | null>;

/**
 * The `type` field of the package.json that scopes a directory, as Node uses it
 * to decide whether a `.js` file is ESM. Like Node, the search stops at a
 * `node_modules` directory, so a dependency without a package.json is
 * CommonJS whatever the project declares. It never leaves the project.
 */
export class PackageTypeLookup {
  readonly #byDirectory = new Map<string, Promise<string | undefined>>();
  readonly #roots: string[];

  /**
   * `projectDirs` are the project root as given and as canonical: the bundler
   * reports paths with symlinks followed.
   */
  constructor(
    private readonly readManifest: ReadManifest,
    projectDirs: string | readonly string[],
  ) {
    this.#roots = (typeof projectDirs === "string" ? [projectDirs] : [...projectDirs])
      .map((directory) => pathHelper.resolve(directory));
  }

  of(directory: string): Promise<string | undefined> {
    let found = this.#byDirectory.get(directory);
    if (!found) {
      found = this.#read(directory);
      this.#byDirectory.set(directory, found);
    }
    return found;
  }

  async #read(directory: string): Promise<string | undefined> {
    if (pathHelper.basename(directory) === "node_modules") return undefined;
    const manifest = await this.readManifest(pathHelper.join(directory, "package.json"));
    if (manifest !== null) {
      try {
        // Node drops a byte order mark before parsing a package.json.
        const text = manifest.charCodeAt(0) === 0xfeff ? manifest.slice(1) : manifest;
        const type = (JSON.parse(text) as { type?: unknown }).type;
        return typeof type === "string" ? type : undefined;
      } catch {
        // Node rejects a malformed package.json; esbuild reports it as well.
        return undefined;
      }
    }
    const parent = pathHelper.dirname(directory);
    if (parent === directory || !this.#roots.some((root) => isWithinDirectory(root, parent))) {
      return undefined;
    }
    return await this.of(parent);
  }
}

/** Host operations {@link createDependencyFilePredicate} needs. */
export interface DependencyRootFileSystem {
  realPath(path: string): Promise<string>;
  readDir(
    path: string,
  ): AsyncIterable<{ name: string; isDirectory: boolean; isSymlink?: boolean }>;
}

async function directoryEntries(fs: DependencyRootFileSystem, path: string) {
  const entries: { name: string; isDirectory: boolean; isSymlink?: boolean }[] = [];
  try {
    for await (const entry of fs.readDir(path)) entries.push(entry);
  } catch {
    // expected: no such directory, as for an adapter-backed project
  }
  return entries;
}

/**
 * Paths in `node_modules` that may be links: package entries, including the
 * packages inside `@scope` directories. Only a link can point outside
 * `node_modules`; a host that does not say whether an entry is one gets every
 * entry checked.
 */
async function possibleLinks(fs: DependencyRootFileSystem, modules: string): Promise<string[]> {
  const links: string[] = [];
  for (const entry of await directoryEntries(fs, modules)) {
    const path = pathHelper.join(modules, entry.name);
    // A linked `@scope` directory holds plain package directories.
    if (entry.name.startsWith("@") && entry.isSymlink !== false) links.push(path);
    const scoped = entry.name.startsWith("@")
      ? (await directoryEntries(fs, path)).map((inner) => ({
        ...inner,
        path: pathHelper.join(path, inner.name),
      }))
      : [{ ...entry, path }];
    for (const candidate of scoped) {
      if (candidate.isSymlink !== false) links.push(candidate.path);
    }
  }
  return links;
}

/**
 * Directories inside the project that `node_modules` links to, as npm, Yarn
 * and pnpm workspaces do. The project root and node_modules never count.
 */
async function linkedWorkspaceDirectories(
  fs: DependencyRootFileSystem,
  root: string,
): Promise<string[]> {
  const modules = pathHelper.join(root, "node_modules");
  const targets: string[] = [];
  for (const link of await possibleLinks(fs, modules)) {
    const target = await fs.realPath(link).catch(() => null); // null: a dangling link
    if (
      target !== null && target !== link && target !== root &&
      isWithinDirectory(root, target) && !isWithinDirectory(modules, target)
    ) {
      targets.push(target);
    }
  }
  return targets;
}

/**
 * The directories that hold installed dependencies' files: the project's
 * `node_modules`, under either the given or the canonical root (esbuild
 * reports paths with symlinks followed), and each workspace package that
 * `node_modules` links to inside the project.
 */
export async function dependencyDirectories(
  projectDir: string,
  fs: DependencyRootFileSystem,
): Promise<string[]> {
  const given = pathHelper.resolve(projectDir);
  // null: an adapter-backed project may have no host directory
  const canonical = await fs.realPath(given).catch(() => null);
  const directories = [
    pathHelper.join(given, "node_modules"),
    ...(canonical === null ? [] : [
      pathHelper.join(canonical, "node_modules"),
      ...await linkedWorkspaceDirectories(fs, canonical),
    ]),
  ];
  return [...new Set(directories)];
}

/** Whether a path is a file inside one of the {@link dependencyDirectories}. */
export function dependencyFilePredicate(directories: readonly string[]): (path: string) => boolean {
  const prefixes = directories.map((directory) => directory + pathHelper.sep);
  return (path) => {
    if (path === "") return false;
    const resolved = pathHelper.resolve(path);
    return prefixes.some((prefix) => resolved.startsWith(prefix));
  };
}

/** {@link dependencyFilePredicate} of the project's {@link dependencyDirectories}. */
export async function createDependencyFilePredicate(
  projectDir: string,
  fs: DependencyRootFileSystem,
): Promise<(path: string) => boolean> {
  return dependencyFilePredicate(await dependencyDirectories(projectDir, fs));
}

// Extensions Node has its own loader for, or refuses; any other file Node's
// require() runs as CommonJS.
const KNOWN_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx|json|node)$/i;

// The loader that parses a dependency file, by extension.
const LOADERS: Record<string, "js" | "jsx" | "ts" | "tsx"> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".jsx": "jsx",
};

/**
 * A name `contents` does not contain, derived from the file alone, so that the
 * same file always yields the same output: the route module is cached by a
 * hash of its code.
 */
async function markerFor(prefix: string, filePath: string, contents: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(filePath + "\0" + contents),
  );
  let marker = prefix + [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  while (contents.includes(marker)) marker += "_";
  return marker;
}

/** Resolves a `require.resolve` literal to a path, or null to leave it for runtime. */
export type ResolveRequireLiteral = (specifier: string) => Promise<string | null>;

/**
 * A dependency file as Node would run it when Node loads it as CommonJS (a
 * `.cjs` or `.cts` file, or a `.js` or extensionless one as below), or null
 * when Node loads it as ESM: a `.mjs` file, a `.js` or `.jsx` file in a
 * `"type": "module"` package, or a `.js`, `.jsx` or extensionless file with
 * ESM syntax, which esbuild bundles as ESM whatever its package says.
 *
 * The file is parsed, not matched as text, so strings and comments are never
 * touched. Unbound reads of `__dirname` and `__filename` become constants, so
 * a file's own binding of either name still wins, and nothing wraps the file:
 * its hashbang and directive prologue are unchanged, and its top-level
 * `arguments` holds Node's five wrapper arguments. A file Node must parse as
 * CommonJS (`.cjs`, `.cts`, or `"type": "commonjs"`) that has ES module
 * syntax throws a `SyntaxError` when it runs, as Node throws when it loads it. Each unbound
 * `require.resolve("literal")` becomes the string Node returns: the id of a
 * built-in, or the path `resolve` finds. One that does not resolve is left for
 * runtime, where it throws `MODULE_NOT_FOUND` as Node does, so an optional
 * dependency probed this way still falls back.
 */
export async function prepareCommonJSFile(
  contents: string,
  filePath: string,
  packageType: string | undefined,
  resolve: ResolveRequireLiteral,
): Promise<string | null> {
  const cjsExtension = /\.c[jt]s$/i.test(filePath);
  // Node's require() loads `.jsx` through its `.js` loader too.
  // Node 24 loads `.ts` by the same rules, with its types stripped.
  const jsExtension = /\.(?:jsx?|ts)$/i.test(filePath);
  // Node's require() loads a file without an extension, or with one it has
  // no loader for, as CommonJS, whatever its package declares; a package
  // `main` may name one.
  const extensionless = !KNOWN_EXTENSION.test(filePath);
  if (!cjsExtension && !extensionless && !(jsExtension && packageType !== "module")) return null;
  // Node parses these as CommonJS whatever their syntax: ES module syntax is
  // a SyntaxError there, not a reason to load the file as a module.
  const forcedCommonJS = cjsExtension || (jsExtension && packageType === "commonjs");

  // The source does not contain the name, so every occurrence in the output
  // is one the parser put there. It never reaches the bundle.
  const marker = await markerFor("__vf_require_resolve_", filePath, contents);
  const requireMarker = await markerFor("__vf_require_call_", filePath, contents);
  const argumentsMarker = await markerFor("__vf_arguments_", filePath, contents);
  const result = await bundle({
    stdin: {
      contents,
      loader: LOADERS[pathHelper.extname(filePath).toLowerCase()] ?? "js",
      sourcefile: filePath,
    },
    bundle: false,
    write: false,
    metafile: true,
    platform: "neutral",
    logLevel: "silent",
    define: {
      "require.resolve": marker,
      require: requireMarker,
      __dirname: JSON.stringify(pathHelper.dirname(filePath)),
      __filename: JSON.stringify(filePath),
      // Only the file's own top-level `arguments`: a function has its own.
      arguments: argumentsMarker,
    },
  });
  const format = Object.values(result.metafile?.inputs ?? {})[0]?.format;
  if (format === "esm") {
    if (!forcedCommonJS) return null;
    // Thrown when the file runs, as Node throws when it loads it.
    return `throw new SyntaxError(${
      JSON.stringify(
        `${pathHelper.basename(filePath)} uses ES module syntax, but Node loads it as CommonJS`,
      )
    });\n`;
  }
  const code = result.outputFiles?.[0]?.text;
  if (code === undefined) throw new Error(`No output for dependency file ${filePath}`);

  const rewritten = await resolveLiteralCalls(
    code,
    marker,
    async (specifier) =>
      builtinModuleName(specifier) === undefined ? await resolve(specifier) : specifier,
  );
  // A literal require() goes back to the bundler, which bundles it. Any other
  // use of `require`, such as a computed id, runs at runtime with the require
  // of this file's directory, as in Node; so does a require.resolve call left
  // unresolved, which throws there as in Node.
  const directory = pathHelper.dirname(filePath);
  // The module's own require when the runtime made its record, so a call it
  // makes later still names it as the parent.
  const boundRequire = `(${BUNDLED_REQUIRE_FROM}(${codeString(directory)}, module))`;
  // Code in a direct eval sees the file's own bindings, which no rewrite of
  // the source reaches; the file declares them, as Node's wrapper does. Its
  // requires then all run at runtime. A file that assigns to `require` also
  // keeps the name: a call is no assignment target.
  // The parser prints every direct-eval spelling, `(eval)(x)` and comments
  // included, as `eval(`; an indirect `(0, eval)(x)` or `eval?.(x)` stays.
  const directEval = /(?<![\w$.])eval\(/.test(rewritten);
  // `=`, and compound assignments such as `||=`, but not a comparison.
  const assigned = new RegExp(
    `${requireMarker}\\s*(?:\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?|[-+*/%&|^])?=(?!=)`,
  ).test(rewritten);
  // A literal require is marked as this module's own, so one a callback
  // makes after the file's body has finished still names it as the parent.
  const ownedRequire = (specifier: string) =>
    directEval || assigned
      ? `require(${JSON.stringify(specifier)})`
      : `${BUNDLED_REQUIRE_FROM}(${codeString(directory)}, module, true)(require(${
        JSON.stringify(specifier)
      }))`;
  const prepared = rewritten
    .replace(
      literalRequire(requireMarker),
      (_whole, double, single, template) => ownedRequire(double ?? single ?? template),
    )
    .replaceAll(marker, `${requireMarker}.resolve`)
    .replaceAll(requireMarker, directEval || assigned ? "require" : boundRequire);
  const wrapperArguments = prepared.includes(argumentsMarker);
  if (!directEval && !assigned && !wrapperArguments) return prepared;
  // After a hashbang and the directive prologue, so "use strict" still applies.
  const head = /^(?:#![^\n]*\n)?(?:(["'])[^"'\n]*\1;\n)*/.exec(prepared)?.[0] ?? "";
  // Node's wrapper gives each file its own `require`, which the file may
  // reassign; the route's own binding must stay untouched.
  const bindings = directEval
    ? `var require = ${boundRequire}, __dirname = ${codeString(directory)}, ` +
      `__filename = ${codeString(filePath)};\n`
    : assigned
    ? `var require = ${boundRequire};\n`
    : "";
  // The bundler's wrapper passes `exports` and `module` only; Node's passes
  // these five, which a file may read through `arguments`.
  const tuple = wrapperArguments
    ? `var ${argumentsMarker} = (function () { return arguments; })(exports, ${
      directEval || assigned ? "require" : boundRequire
    }, module, ${codeString(filePath)}, ${codeString(directory)});\n`
    : "";
  return head + bindings + tuple + prepared.slice(head.length);
}

// A call of `marker` with one string literal as the bundler prints it; a
// template literal only without substitutions.
function literalRequire(marker: string): RegExp {
  return new RegExp(
    `${marker}\\((?:"([^"\\\\\\n]*)"|'([^'\\\\\\n]*)'|\`([^\`\\\\\\n$]*)\`)\\)`,
    "g",
  );
}

/**
 * Replaces each call of `marker` with one string literal argument by the
 * string `resolve` returns for it. A call it returns null for, and any other
 * use of `marker`, is left unchanged. The literal must be as the bundler
 * prints it: quoted, with no escapes.
 */
export async function resolveLiteralCalls(
  code: string,
  marker: string,
  resolve: (specifier: string) => Promise<string | null>,
): Promise<string> {
  const literalCall = new RegExp(`${marker}\\((["'])([^"'\\\\\\n]*)\\1\\)`, "g");
  const resolved = new Map<string, string | null>();
  for (const match of code.matchAll(literalCall)) {
    const specifier = match[2]!;
    if (!resolved.has(specifier)) resolved.set(specifier, await resolve(specifier));
  }
  return code.replace(literalCall, (whole, _quote, specifier: string) => {
    const target = resolved.get(specifier);
    return typeof target === "string" ? JSON.stringify(target) : whole;
  });
}

/** Resolves an `import.meta.resolve` literal to a URL, or null to leave it for runtime. */
export type ResolveImportMetaLiteral = (specifier: string) => Promise<string | null>;

/**
 * An ES module dependency file with its `import.meta` locations pointing at
 * the file itself, not at the route bundle it ends up in. Unbound reads of
 * `import.meta.url`, `import.meta.filename` and `import.meta.dirname` become
 * constants. Each `import.meta.resolve("literal")` becomes the URL `resolve`
 * finds. Any other use of `import.meta.resolve`, computed or detached, calls a
 * resolver bound to the file: it resolves URLs and relative paths against the
 * file, built-ins to their `node:` ids, and package names and the package's
 * own `#imports` through the runtime `require`'s lookup with the `import`
 * condition. Any other read of `import.meta` gets an object with these four
 * properties.
 */
export async function prepareModuleFile(
  contents: string,
  filePath: string,
  resolve: ResolveImportMetaLiteral,
  suffix = "",
): Promise<string> {
  // The module's URL keeps the query or fragment it was imported with.
  const url = pathHelper.toFileUrl(filePath).href + suffix;
  const marker = await markerFor("__vf_import_meta_resolve_", filePath, contents);
  // An ES module has no `require`; the route module's binding of that name
  // must not show through. The file's unbound uses read a name nothing
  // declares, so, as in Node's strict ES modules, `typeof` reads
  // "undefined" and a call or an assignment throws a ReferenceError.
  const requireMarker = `${marker}_require`;
  const result = await bundle({
    stdin: {
      contents,
      loader: LOADERS[pathHelper.extname(filePath).toLowerCase()] ?? "js",
      sourcefile: filePath,
    },
    bundle: false,
    write: false,
    platform: "neutral",
    logLevel: "silent",
    define: {
      // The most specific name wins: `import.meta` alone is any other use.
      "import.meta": `${marker}_meta`,
      "import.meta.resolve": marker,
      "import.meta.url": JSON.stringify(url),
      "import.meta.filename": JSON.stringify(filePath),
      "import.meta.dirname": JSON.stringify(pathHelper.dirname(filePath)),
      require: requireMarker,
    },
  });
  const code = result.outputFiles?.[0]?.text;
  if (code === undefined) throw new Error(`No output for dependency file ${filePath}`);
  if (!code.includes(marker)) return code;

  const rewritten = await resolveLiteralCalls(code, marker, resolve);
  if (!rewritten.replaceAll(requireMarker, "").includes(marker)) return rewritten;
  const prologue = [
    // The resolver is a declaration, so it is hoisted: a cyclic import may
    // call into the file before its body runs.
    `function ${marker}(specifier) {`,
    `  return ${importResolver(url, filePath)}(specifier);`,
    "}",
    // Node's import.meta of an imported module: a null prototype, and
    // `main` false.
    `const ${marker}_meta = { __proto__: null, dirname: ${
      codeString(pathHelper.dirname(filePath))
    }, filename: ${codeString(filePath)}, main: false, resolve: ${marker}, url: ${
      codeString(url)
    } };`,
  ].join("\n");
  // A hashbang is only valid as the first line.
  const hashbangEnd = rewritten.startsWith("#!") ? rewritten.indexOf("\n") + 1 : 0;
  return rewritten.slice(0, hashbangEnd) + prologue + "\n" + rewritten.slice(hashbangEnd);
}

// The source of an expression that is the runtime `import.meta.resolve` of
// the dependency file at `filePath`, whose URL is `url`; see
// {@link createImportMetaResolve}.
function importResolver(url: string, filePath: string): string {
  return `(${createImportMetaResolve.toString()})(${codeString(url)}, ${
    JSON.stringify([...PREFIX_ONLY_BUILTINS])
  }, (id) => globalThis.process?.getBuiltinModule?.(id), (id) => typeof ${BUNDLED_REQUIRE_FROM} === "function" ? ${BUNDLED_REQUIRE_FROM}(${
    codeString(pathHelper.dirname(filePath))
  }).resolve(id, { [Symbol.for("veryfront.importConditions")]: true }) : null, globalThis.process?.platform)`;
}

/**
 * `code`, a dependency file, with each `import()` the bundler cannot follow
 * bound to the file: its specifier resolves as `import.meta.resolve` in the
 * file would (see {@link createImportMetaResolve}), so a relative path loads
 * the file's sibling and a package name the file's own dependency, not
 * whatever the route bundle's location would give. A specifier that does not
 * resolve rejects the import, as Node's does. A literal specifier, and a
 * relative template or concatenation the bundler expands into the files it
 * matches, stay for the bundler.
 */
export async function bindDynamicImports(
  code: string,
  filePath: string,
  url: string,
): Promise<string> {
  if (!/\bimport\s*\(/.test(code)) return code;
  const { masked, imports, unmask } = await parseMaskedImports(code);
  const computed = imports.filter((entry) =>
    // A dynamic import whose specifier is no literal.
    entry.d >= 0 && entry.n === undefined &&
    !/^\s*(["'`])\.\.?\//.test(masked.slice(entry.s, entry.e))
  );
  if (computed.length === 0) return code;
  const marker = await markerFor("__vf_dynamic_import_", filePath, code);
  let result = masked;
  for (const entry of [...computed].sort((a, b) => b.s - a.s)) {
    result = result.slice(0, entry.s) + `${marker}(${result.slice(entry.s, entry.e)})` +
      result.slice(entry.e);
  }
  // A declaration at the end, so it is hoisted without displacing a hashbang
  // or a directive prologue. A specifier that fails to resolve becomes one
  // whose conversion to a string throws, so `import()` rejects with the error
  // rather than throwing it.
  const resolver = [
    "",
    `function ${marker}(specifier) {`,
    "  try {",
    `    return ${importResolver(url, filePath)}(specifier);`,
    "  } catch (error) {",
    "    return { toString() { throw error; } };",
    "  }",
    "}",
    "",
  ].join("\n");
  return unmask(result) + resolver;
}

/**
 * The runtime `import.meta.resolve` of a bundled dependency module at
 * `moduleUrl`: URLs and relative paths resolve against the module, built-ins
 * to their `node:` ids, and a package name or `#import` to the URL
 * `resolvePackage` finds. One it cannot find throws `ERR_MODULE_NOT_FOUND`.
 *
 * {@link prepareModuleFile} embeds this function's source in the module, so
 * it must not refer to anything outside its own body.
 */
export function createImportMetaResolve(
  moduleUrl: string,
  prefixOnlyNames: readonly string[],
  getBuiltinModule: (id: string) => unknown,
  resolvePackage: (id: string) => string | null = () => null,
  platform: string = "linux",
): (specifier: unknown) => string {
  const windows = platform === "win32";
  // A POSIX file URL names no host; Node rejects one that does.
  const local = (url: URL) => {
    if (url.protocol === "file:" && url.hostname !== "" && !windows) {
      const error = new TypeError(
        'File URL host must be "localhost" or empty on ' + platform,
      ) as TypeError & { code?: string };
      error.code = "ERR_INVALID_FILE_URL_HOST";
      throw error;
    }
    return url.href;
  };
  return (specifier) => {
    const id = String(specifier);
    if (/^[a-z][a-z0-9+.-]*:/i.test(id)) return local(new URL(id));
    if (/^(?:\.\.?(?:\/|$)|\/)/.test(id)) return local(new URL(id, moduleUrl));
    // A bare prefix-only name such as `test` is a package, as in Node.
    if (!prefixOnlyNames.includes(id) && getBuiltinModule(id) !== undefined) return "node:" + id;
    let found: string | null = null;
    try {
      found = resolvePackage(id);
    } catch (error) {
      // A malformed package.json is reported as it is; anything else is not
      // found, reported below with ESM's code.
      if ((error as { code?: unknown })?.code === "ERR_INVALID_PACKAGE_CONFIG") throw error;
    }
    if (found !== null) return found;
    const error = new Error(
      "Cannot find package " + JSON.stringify(id) + " imported from a bundled dependency",
    ) as Error & { code?: string };
    error.code = "ERR_MODULE_NOT_FOUND";
    throw error;
  };
}

/**
 * The name a bundled CommonJS dependency calls for the `require` of its own
 * directory; see {@link RuntimeRequireBinding.requireFrom}.
 */
export const BUNDLED_REQUIRE_FROM = "__vf_require_from";

/**
 * A dependency's JSON file as a CommonJS module, which the runtime `require`
 * caches like any bundled dependency, so a computed `require()` of the same
 * file returns the same object, as in Node. Malformed JSON fails the build, as
 * the bundler's JSON loader would.
 */
export function prepareDependencyJson(contents: string): string {
  // Node drops a byte order mark before parsing JSON.
  const json = contents.charCodeAt(0) === 0xfeff ? contents.slice(1) : contents;
  JSON.parse(json);
  return `module.exports = JSON.parse(${JSON.stringify(json)});\n`;
}

/**
 * How the build loads a dependency's JSON file: the CommonJS module of
 * {@link prepareDependencyJson}, which the runtime `require` caches. Node 24
 * gives a `{ type: "json" }` import of the file that same module. An import
 * with a query or fragment is a module of its own, as in Node, so it loads
 * as plain JSON.
 */
export function dependencyJsonLoad(
  contents: string,
  attributes?: Readonly<Record<string, string>>,
  suffix = "",
): { contents: string; loader: "js" | "json" } {
  if (attributes?.type === "json" && suffix !== "") {
    const json = contents.charCodeAt(0) === 0xfeff ? contents.slice(1) : contents;
    return { contents: json, loader: "json" };
  }
  return { contents: prepareDependencyJson(contents), loader: "js" };
}

/** Input for {@link prepareDependencyFile}. */
export interface DependencyFileInput {
  readonly build: PluginBuild;
  readonly contents: string;
  /** The file's path as the project sees it. */
  readonly logicalPath: string;
  /** The path the bundler resolved, used as the importer for resolution. */
  readonly resolvedPath: string;
  /** The `type` field of the package.json that scopes the file. */
  readonly packageType: string | undefined;
  readonly isDependencyFile: (path: string) => boolean;
  readonly isFile: IsFile;
  /** The query or fragment the file was imported with, as the bundler reports it. */
  readonly suffix?: string;
}

/**
 * A bundled dependency file as Node would run it: see
 * {@link prepareCommonJSFile} and {@link prepareModuleFile}. A literal
 * location resolves at build time only to a file inside the project's
 * dependencies.
 */
export async function prepareDependencyFile(input: DependencyFileInput): Promise<string> {
  return await bindDynamicImports(
    await prepareDependencySource(input),
    input.logicalPath,
    pathHelper.toFileUrl(input.logicalPath).href + (input.suffix ?? ""),
  );
}

async function prepareDependencySource(input: DependencyFileInput): Promise<string> {
  const { build, contents, logicalPath, resolvedPath, isDependencyFile } = input;
  // A file Node parses as CommonJS whatever its syntax.
  const forcedCommonJS = /\.c[jt]s$/i.test(logicalPath) ||
    (/\.(?:jsx?|ts)$/i.test(logicalPath) && input.packageType === "commonjs");
  // Most package files read none of these names; parsing them would change
  // nothing. The check is textual, so it can only send extra files to the parser.
  // An ES module by its extension or package, where any `require` is free.
  const knownModule = /\.m[jt]s$/i.test(logicalPath) ||
    (/\.(?:jsx?|ts)$/i.test(logicalPath) && input.packageType === "module");
  const importMeta = /\bimport\.meta\b/.test(contents) ||
    (knownModule && /\brequire\b/.test(contents));
  const readsCommonJSNames = contents.includes("__dirname") ||
    contents.includes("__filename") ||
    /\barguments\b/.test(contents) ||
    // Any use of require but a call with a string literal, which the bundler
    // bundles: a computed id must resolve from this file's directory.
    /\brequire\b/.test(contents.replace(LITERAL_REQUIRE_CALL, "")) ||
    // A direct eval, in any spelling, may read any of them.
    /\beval\b/.test(contents) ||
    // ES module syntax, which such a file must not run as.
    (forcedCommonJS && /\b(?:import|export)\b/.test(contents));
  // A literal require, which the bundler bundles; a CommonJS file marks it as
  // its own, see prepareCommonJSFile.
  const literalRequires = /\brequire\s*\(\s*["'`]/.test(contents);
  if (!readsCommonJSNames && !importMeta && !literalRequires) return contents;
  const resolveDir = pathHelper.dirname(resolvedPath);
  const dependencyPath = async (
    specifier: string,
    kind: "require-resolve" | "import-statement",
  ) => {
    if (!build.resolve) return null;
    const result = await build.resolve(specifier, { kind, importer: resolvedPath, resolveDir });
    if (result.errors?.length || !result.path || result.external) return null;
    if (!isDependencyFile(result.path)) return null;
    // Only require() reads a Windows backslash as a separator.
    const sep = kind === "require-resolve" ? pathHelper.sep : "/";
    return {
      path: await nodePreferredFile(result.path, specifier, resolveDir, input.isFile, sep),
      // A package target's query or fragment: import.meta.resolve keeps it.
      suffix: result.suffix ?? "",
    };
  };
  const commonJS = await prepareCommonJSFile(
    contents,
    logicalPath,
    input.packageType,
    async (specifier) => (await dependencyPath(specifier, "require-resolve"))?.path ?? null,
  );
  if (commonJS !== null) return commonJS;
  // An ES module's literal require stays for the bundler, as it was.
  if (!readsCommonJSNames && !importMeta) return contents;
  if (!importMeta && !/\brequire\b/.test(contents)) return contents;
  const moduleUrl = pathHelper.toFileUrl(logicalPath).href + (input.suffix ?? "");
  return await prepareModuleFile(contents, logicalPath, async (specifier) => {
    const builtin = builtinModuleName(specifier);
    if (builtin !== undefined) return "node:" + builtin;
    // A `#name` resolves through the package's own `imports`, below.
    if (URL_SPECIFIER.test(specifier) || RELATIVE_SPECIFIER.test(specifier)) {
      const url = new URL(specifier, moduleUrl);
      // A file URL with a host is Node's runtime error; the resolver throws it.
      return url.protocol === "file:" && url.hostname !== "" && pathHelper.sep === "/"
        ? null
        : url.href;
    }
    const found = await dependencyPath(specifier, "import-statement");
    return found === null ? null : pathHelper.toFileUrl(found.path).href + found.suffix;
  }, input.suffix ?? "");
}

/**
 * Applies a text rewrite of import specifiers to the parsed imports of `code`
 * only. A bundle holds package code whose strings may read like imports, such
 * as `'from "fs"'`; those stay as written. `rewrite` sees one
 * `export * from "specifier";` line per distinct specifier and must keep one
 * import per line.
 */
export async function rewriteImportSpecifiers(
  code: string,
  rewrite: (probe: string) => Promise<string>,
): Promise<string> {
  const specifiers = [
    ...new Set(
      (await parseImports(code))
        .map((entry) => entry.n)
        .filter((specifier): specifier is string => typeof specifier === "string"),
    ),
  ];
  if (specifiers.length === 0) return code;
  const probe = specifiers.map((specifier) => `export * from ${JSON.stringify(specifier)};`);
  const rewritten = (await parseImports(await rewrite(probe.join("\n")))).map((entry) => entry.n);
  if (rewritten.length !== specifiers.length || rewritten.some((entry) => entry === undefined)) {
    throw new Error("[API] handler build failed: import specifiers could not be rewritten");
  }
  const replacements = new Map(
    specifiers.map((specifier, index) => [specifier, rewritten[index]!]),
  );
  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier));
}

/** Host operations the runtime `require` uses; see {@link createRuntimeRequire}. */
export interface RuntimeRequireHost {
  getBuiltinModule(id: string): unknown;
  isFile(path: string): boolean;
  realpathSync(path: string): string;
  readFileSync(path: string, encoding: "utf8"): string;
  /** Compiles a CommonJS module body. */
  compile(source: string, filename: string): CommonJSModuleBody;
  /** Node's `stripTypeScriptTypes`, when the runtime has it. */
  stripTypes?: (source: string) => string;
  /** A path's `file:` URL. */
  toFileUrl(path: string): string;
  /** The process's working directory, which relative `paths` entries resolve from. */
  cwd(): string;
  isAbsolute(path: string): boolean;
  relative(from: string, to: string): string;
  join(...paths: string[]): string;
  dirname(path: string): string;
  readonly sep: string;
}

/** A compiled CommonJS module body, called with `this` set to `exports`. */
export type CommonJSModuleBody = (
  exports: unknown,
  require: RuntimeRequire,
  module: RuntimeModule,
  filename: string,
  dirname: string,
) => void;

/** The `module` a CommonJS file the runtime `require` loads sees. */
export interface RuntimeModule {
  exports: unknown;
  id: string;
  filename: string;
  path: string;
  /** The `node_modules` directories its package ids are looked up in. */
  paths: string[];
  loaded: boolean;
  /** The module that first required it, if it was required from a module. */
  parent: RuntimeModule | undefined;
  children: RuntimeModule[];
  require: RuntimeRequire;
}

/** {@link createRuntimeRequire}'s result. */
export interface RuntimeRequireBinding {
  readonly require: RuntimeRequire;
  /**
   * Runs a CommonJS file the bundler bundled, named by `key` relative to the
   * bundle's working directory, through the module cache that computed
   * requires use, as Node's one cache: it runs once, is in `require.cache`
   * before its body runs, leaves it if the body throws, and runs again once
   * deleted from it. Null for a file that is not a dependency, which the
   * bundler caches itself.
   */
  readonly bundled: (
    key: unknown,
    body: (exports: unknown, module: { exports: unknown }) => void,
  ) => { exports: unknown } | null;
  /**
   * The `require` of a bundled dependency file in `directory`, for the calls
   * the bundler left to runtime, such as a computed relative id.
   */
  readonly requireFrom: {
    (directory: unknown, module?: unknown): RuntimeRequire;
    /**
     * With `bind`, marks the bundled literal require that the caller makes
     * next as `module`'s own, and returns a function that hands back its
     * result: `requireFrom(directory, module, true)(require("./lazy"))`.
     */
    (directory: unknown, module: unknown, bind: true): <T>(value: T) => T;
  };
}

/** The runtime `require` of a bundled route; see {@link createRuntimeRequire}. */
export interface RuntimeRequire {
  (id: unknown): unknown;
  /** Node's `require.resolve`, including its `paths` option and `paths()` helper. */
  resolve: ((id: unknown, options?: { paths?: unknown }) => string) & {
    paths(request: unknown): string[] | null;
  };
  /** Loaded modules by real path; deleting one makes the next load run it again. */
  cache: Record<string, { exports: unknown }>;
  /** webpack's `require.ensure`: everything is loaded already. */
  ensure(ids: unknown, callback: (require: RuntimeRequire) => void): void;
}

/**
 * The `require` that esbuild's output calls for anything it did not bundle:
 * a computed id, or a built-in. Ids resolve as Node's `require()` resolves
 * them, from the project for route code and from its own directory for a
 * module this loaded:
 *
 * - A built-in loads under any id Node accepts.
 * - A path finds a file in Node's order: the path, then with `.js` or
 *   `.json`, then its `index.js` or `index.json`.
 * - A package name is looked up in `node_modules` upwards, through the
 *   package's `exports` (exact keys and `*` patterns; `node`, `require` and
 *   `default` conditions, or `import` and `module-sync` for a bundled module's
 *   `import.meta.resolve`) or its `main`. A `#name` reads the `imports` of the
 *   package that holds the module.
 *
 * Whatever it finds must have its real path inside the project, and nothing
 * looks above it. JSON loads from anywhere in the project. JavaScript loads
 * only from the project's dependencies, as CommonJS, with its own `require`
 * and `module`, its TypeScript types stripped as Node 24 strips them. A native
 * addon or an ES module throws. Each file loads once, and bundled files share
 * the same cache; see {@link RuntimeRequireBinding.bundled}. `require.cache` holds them by real
 * path, `require.resolve` returns the path it found and takes Node's `paths`
 * option, and `require.ensure`, which code written for webpack calls, runs
 * its callback. Anything else throws `MODULE_NOT_FOUND`, so optional
 * dependencies probed in a `try` still fall back.
 *
 * Errors name a path relative to the project, never the host path.
 * {@link prependRuntimeRequire} embeds this function's source in the route
 * module, so it must not refer to anything outside its own body.
 */
export function createRuntimeRequire(
  host: RuntimeRequireHost,
  projectRoot: string,
  prefixOnlyNames: readonly string[],
  dependencyDirectories: readonly string[],
  bundleRoot?: string,
): RuntimeRequireBinding {
  // Tables without a prototype: `in` reads only their own keys and does not
  // depend on built-ins that route code could replace later.
  const prefixOnly: Record<string, true> = Object.create(null);
  for (const name of prefixOnlyNames) prefixOnly[name] = true;
  const modules: Record<string, RuntimeModule> = Object.create(null);
  // Set while resolving for `import.meta.resolve`, which reads a package map's
  // `import` condition where require() reads `require`; see `resolve`.
  let importing = false;
  const failure = (message: string, code: string) => {
    const error = new Error(message) as Error & { code?: string };
    error.code = code;
    return error;
  };
  // Node's argument checks throw a TypeError, before any lookup, so code that
  // catches `MODULE_NOT_FOUND` never mistakes a wrong argument for a missing
  // optional dependency.
  const invalidArgument = (message: string, code: string) => {
    const error = new TypeError(message) as TypeError & { code?: string };
    error.code = code;
    return error;
  };
  const received = (value: unknown) =>
    value === null || value === undefined
      ? "Received " + value
      : typeof value === "function"
      ? "Received function " + ((value as { name?: string }).name || "<anonymous>")
      : typeof value === "object"
      ? "Received an instance of " +
        ((value as { constructor?: { name?: string } }).constructor?.name || "Object")
      : "Received type " + typeof value + " (" + String(value) + ")";
  function requireString(value: unknown, name: string): asserts value is string {
    if (typeof value !== "string") {
      throw invalidArgument(
        'The "' + name + '" argument must be of type string. ' + received(value),
        "ERR_INVALID_ARG_TYPE",
      );
    }
  }
  const dependencyPrefixes = dependencyDirectories.map((directory) => directory + host.sep);
  const builtin = (id: unknown) => {
    // A bare prefix-only name such as `test` is an npm package, as in Node.
    if (typeof id !== "string" || id in prefixOnly) return undefined;
    return host.getBuiltinModule(id);
  };
  const missing = (label: string) =>
    failure("Cannot find module " + JSON.stringify(label), "MODULE_NOT_FOUND");
  // An existing file whose real path is in the project.
  const projectFile = (path: string) => {
    if (!host.isFile(path)) return null;
    let real: string;
    try {
      real = host.realpathSync(path);
    } catch {
      return null;
    }
    const relative = host.relative(projectRoot, real);
    const up = relative === ".." || relative.startsWith(".." + host.sep);
    if (relative === "" || up || host.isAbsolute(relative)) return null;
    return { path, real, relative };
  };
  // A path relative to the requiring file; on Windows a backslash separates too.
  const relativeId = (id: string) =>
    id === "." || id === ".." || id.startsWith("./") || id.startsWith("../") ||
    id.startsWith("." + host.sep) || id.startsWith(".." + host.sep);
  const first = (candidates: string[]) => {
    for (const candidate of candidates) {
      const found = projectFile(candidate);
      if (found !== null) return found;
    }
    return null;
  };
  const asFile = (base: string) => first([base, base + ".js", base + ".json", base + ".node"]);
  const asIndex = (directory: string) =>
    first(["index.js", "index.json", "index.node"].map((name) => host.join(directory, name)));
  // A file at `base` in Node's order: the file with Node's extensions, then
  // the directory's package.json `main`, then its index.
  const findFile = (base: string) => {
    const file = asFile(base);
    if (file !== null) return file;
    const manifest = readManifest(base);
    // Node refuses a directory whose package.json is malformed.
    if (manifest === null) throw invalidConfig(base);
    const main = manifest?.main;
    if (typeof main === "string") {
      const target = host.join(base, main);
      const found = asFile(target) ?? asIndex(target);
      if (found !== null) return found;
    }
    return asIndex(base);
  };
  // The target a package's `exports` or `imports` gives `require()`: the
  // `node`, `require` and `default` conditions, in the order it lists them.
  // null blocks the path, even when a later condition would match; undefined
  // means no condition matched.
  const conditionalTarget = (
    value: unknown,
    valid: (target: string) => boolean = () => true,
  ): string | null | undefined => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      // As in Node, the first item that resolves to a valid target wins; a
      // null, unmatched or invalid item falls through to the next.
      for (const item of value) {
        const target = conditionalTarget(item, valid);
        if (typeof target === "string" && valid(target)) return target;
      }
      return null;
    }
    if (value === null || typeof value !== "object") return null;
    for (const [condition, item] of Object.entries(value)) {
      // `module-sync` only for an import: this require() cannot run an ES
      // module, which is when Node turns the condition off too.
      const active = condition === "node" || condition === "default" ||
        (importing
          ? condition === "import" || condition === "module-sync"
          : condition === "require");
      if (!active) continue;
      const target = conditionalTarget(item, valid);
      if (target !== undefined) return target;
    }
    return undefined;
  };
  // A key of a package's `exports` or `imports` map, as Node matches it: an
  // exact key, else the `*` pattern with the longest prefix, whose match
  // replaces each `*` in the target.
  const mapTarget = (
    map: Record<string, unknown>,
    key: string,
    valid: (target: string) => boolean,
  ): string | null => {
    if (!key.includes("*") && Object.hasOwn(map, key)) {
      return conditionalTarget(map[key], valid) ?? null;
    }
    let best: { pattern: string; match: string } | null = null;
    for (const pattern of Object.keys(map)) {
      const star = pattern.indexOf("*");
      if (star === -1 || pattern.indexOf("*", star + 1) !== -1) continue;
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (
        key.length < pattern.length || !key.startsWith(prefix) || !key.endsWith(suffix) ||
        key === prefix
      ) {
        continue;
      }
      const longer = best === null || prefix.length > best.pattern.indexOf("*") ||
        (prefix.length === best.pattern.indexOf("*") && pattern.length > best.pattern.length);
      if (longer) best = { pattern, match: key.slice(prefix.length, key.length - suffix.length) };
    }
    if (best === null) return null;
    const target = conditionalTarget(map[best.pattern], valid);
    return typeof target === "string" ? target.split("*").join(best.match) : null;
  };
  // Node's error for a malformed package.json, which it never skips.
  const invalidConfig = (packageDir: string) =>
    failure(
      "Invalid package config " +
        JSON.stringify(host.relative(projectRoot, host.join(packageDir, "package.json"))),
      "ERR_INVALID_PACKAGE_CONFIG",
    );
  const readManifest = (packageDir: string): Record<string, unknown> | null | undefined => {
    const manifestPath = host.join(packageDir, "package.json");
    if (!host.isFile(manifestPath)) return undefined;
    try {
      const text = host.readFileSync(manifestPath, "utf8");
      // Node drops a byte order mark before parsing a package.json.
      const manifest = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
      return manifest !== null && typeof manifest === "object" ? manifest : null;
    } catch {
      return null; // Node rejects a malformed package.json
    }
  };
  // A `./` target of a package map, which Node rejects if any later segment
  // is empty, `.`, `..` or `node_modules`, so it cannot leave its package.
  // A target is a URL path, so its escapes name the file: `%20` is a space.
  // Its query or fragment is not part of the file's path.
  const targetSegments = (target: string) => {
    if (!target.startsWith("./")) return null;
    const decoded: string[] = [];
    for (const segment of target.slice(2).split(/[?#]/)[0]!.split(/[\\/]/)) {
      let name: string;
      try {
        name = decodeURIComponent(segment);
      } catch {
        return null;
      }
      const lower = name.toLowerCase();
      if (
        lower === "" || lower === "." || lower === ".." || lower === "node_modules" ||
        /[\\/]/.test(name)
      ) {
        return null;
      }
      decoded.push(name);
    }
    return decoded;
  };
  const packageTarget = (packageDir: string, target: string) => {
    const segments = targetSegments(target);
    if (segments === null) return null;
    const path = host.join(packageDir, ...segments);
    // An import keeps the target's query or fragment in the module's URL.
    const suffix = /[?#][\s\S]*$/.exec(target)?.[0] ?? "";
    const found = projectFile(path);
    if (found !== null) return { ...found, suffix };
    // import.meta.resolve names the target without loading it, as in Node.
    if (!importing || !inProject(packageDir)) return null;
    return { path, real: path, relative: host.relative(projectRoot, path), suffix };
  };
  const validExport = (target: string) => targetSegments(target) !== null;
  // An `imports` target may also name a package.
  const validImport = (target: string) =>
    validExport(target) ||
    !(target.startsWith(".") || target.startsWith("/") || target.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(target));
  // The `type` of the package.json that scopes a file, as Node reads it.
  const packageType = (file: string) => packageScope(host.dirname(file))?.manifest.type;
  const inProject = (directory: string) => {
    const relative = host.relative(projectRoot, directory);
    return !(relative === ".." || relative.startsWith(".." + host.sep) ||
      host.isAbsolute(relative));
  };
  // A package's file for `subpath` ("" or "/sub"), as Node's require() picks
  // it; false when the package is there but refuses the subpath (its
  // `exports` or a malformed package.json), which ends Node's search.
  const packageFile = (packageDir: string, subpath: string) => {
    const manifest = readManifest(packageDir);
    if (manifest === null) throw invalidConfig(packageDir);
    const exports = manifest?.exports;
    if (exports !== undefined && exports !== null) {
      const key = "." + subpath;
      const keys = typeof exports === "object" && !Array.isArray(exports)
        ? Object.keys(exports)
        : [];
      const subpathKeys = keys.filter((name) => name.startsWith(".")).length;
      // Node rejects an `exports` object that mixes subpaths and conditions.
      if (subpathKeys > 0 && subpathKeys !== keys.length) return false;
      const target = subpathKeys > 0
        ? mapTarget(exports as Record<string, unknown>, key, validExport)
        : key === "."
        ? conditionalTarget(exports, validExport) ?? null
        : null;
      return (target === null ? null : packageTarget(packageDir, target)) ?? false;
    }
    return findFile(host.join(packageDir, subpath));
  };
  // A package name looked up in `node_modules` from `directory` upwards, as
  // Node's require() does, never above the project.
  const findPackage = (id: string, directory: string, self = true) => {
    const parts = id.split("/");
    const nameLength = id.startsWith("@") ? 2 : 1;
    if (
      parts.length < nameLength ||
      parts.some((part, index) =>
        part === ".." ||
        // The name itself; Node reads `pkg/`, `pkg//` and `pkg/.` as the package.
        (index < nameLength && (part === "" || part === ".")) ||
        // A Windows separator would let the name walk out of node_modules.
        (host.sep !== "/" && part.includes(host.sep))
      )
    ) {
      return null;
    }
    const name = parts.slice(0, nameLength).join("/");
    const subpath = parts.length > nameLength ? "/" + parts.slice(nameLength).join("/") : "";
    // Node first lets a package with `exports` name itself, before any copy
    // in `node_modules`.
    const scope = self ? packageScope(directory) : null;
    if (scope != null && scope.manifest.name === name && scope.manifest.exports != null) {
      return packageFile(scope.directory, subpath) || null;
    }
    let current = directory;
    while (inProject(current)) {
      if (!current.endsWith(host.sep + "node_modules")) {
        const found = packageFile(host.join(current, "node_modules", name), subpath);
        if (found === false) return null;
        if (found !== null) return found;
      }
      const parent = host.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
    return null;
  };
  // The nearest package.json that scopes `directory`, as Node finds it:
  // never past a `node_modules` directory or the project. Node refuses to
  // load a file, or resolve from one, whose package scope is malformed.
  const packageScope = (directory: string) => {
    let current = directory;
    while (inProject(current) && !current.endsWith(host.sep + "node_modules")) {
      const manifest = readManifest(current);
      if (manifest === null) throw invalidConfig(current);
      if (manifest !== undefined) return { directory: current, manifest };
      const parent = host.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
    return null;
  };
  // A `#name` from the `imports` of the package that holds `directory`.
  const packageImport = (id: string, directory: string) => {
    const scope = packageScope(directory);
    const imports = scope?.manifest.imports;
    if (
      scope == null || imports === null || typeof imports !== "object" || Array.isArray(imports)
    ) {
      return null;
    }
    const target = mapTarget(imports as Record<string, unknown>, id, validImport);
    if (target === null) return null;
    if (target.startsWith("./")) return packageTarget(scope.directory, target);
    return target.startsWith("#") || target.startsWith("/") || target.startsWith(".")
      ? null
      : findPackage(target, scope.directory);
  };
  // `self` is false for a `paths` entry, which only searches; the caller's
  // own package scope is read once, from where the call was made.
  const find = (id: unknown, directory: string | undefined, self = true) => {
    if (typeof id !== "string") return null;
    // Node reads the caller's package scope first, for a self-reference, so
    // a malformed one fails every id that is not a built-in.
    if (self && directory !== undefined) packageScope(directory);
    if (host.isAbsolute(id)) return findFile(id);
    if (directory === undefined) return null;
    if (relativeId(id)) return findFile(host.join(directory, id));
    if (id.startsWith("#")) return packageImport(id, directory);
    return findPackage(id, directory, self);
  };
  const label = (id: unknown) =>
    typeof id === "string" && (host.isAbsolute(id) || relativeId(id))
      ? "a path outside this project or missing"
      : String(id);
  // The bundled module whose body is running: the parent of what its literal
  // and directory-bound requires load. A module the runtime require runs
  // has its own require, which names it.
  let active: RuntimeModule | undefined;
  // The module whose literal require is about to run, set by `requireFrom`
  // with `bind` just before the call: a call a module's callback makes after
  // its body has finished still names that module as the parent. The next
  // load takes it.
  let pending: RuntimeModule | undefined;
  // The module records this runtime made.
  const records = new WeakSet<RuntimeModule>();
  // Records `child` as loaded by `parent`, once, as Node's module graph does.
  const adopt = (parent: RuntimeModule | undefined, child: RuntimeModule) => {
    if (parent !== undefined && !parent.children.includes(child)) parent.children.push(child);
    return child;
  };
  const newModule = (
    real: string,
    parent: RuntimeModule | undefined,
    require: (module: () => RuntimeModule) => RuntimeRequire,
  ) => {
    const directory = host.dirname(real);
    const module: RuntimeModule = {
      exports: {},
      id: real,
      filename: real,
      path: directory,
      paths: lookupPaths(directory),
      loaded: false,
      parent,
      children: [],
      require: require(() => module),
    };
    records.add(module);
    return adopt(parent, module);
  };
  // A module whose load failed leaves the cache and its parent's children,
  // as in Node.
  const drop = (module: RuntimeModule) => {
    if (modules[module.id] === module) delete modules[module.id];
    const siblings = module.parent?.children;
    const index = siblings?.indexOf(module) ?? -1;
    if (index !== -1) siblings!.splice(index, 1);
  };
  const evaluate = (real: string, parent: RuntimeModule | undefined) => {
    const directory = host.dirname(real);
    const module = newModule(real, parent, (owner) => create(directory, owner));
    const require = module.require;
    modules[real] = module;
    try {
      // Reading may fail too; the module then leaves the cache, as in Node.
      let source = host.readFileSync(real, "utf8");
      // Node 24 strips TypeScript's types and runs the rest as JavaScript.
      if (/\.c?ts$/i.test(real)) {
        if (host.stripTypes === undefined) {
          throw failure(
            "TypeScript is not supported here: " + JSON.stringify(host.relative(projectRoot, real)),
            "ERR_UNKNOWN_FILE_EXTENSION",
          );
        }
        source = host.stripTypes(source);
      }
      // A hashbang is not JavaScript; Node ignores it too.
      host.compile(source.startsWith("#!") ? "//" + source : source, real).call(
        module.exports,
        module.exports,
        require,
        module,
        real,
        directory,
      );
    } catch (error) {
      drop(module);
      throw error;
    }
    module.loaded = true;
    return module.exports;
  };
  const isDependency = (real: string) =>
    dependencyPrefixes.some((prefix) => real.startsWith(prefix));
  const load = (found: { real: string; relative: string }, parent: RuntimeModule | undefined) => {
    const real = found.real;
    if (real in modules) return adopt(parent, modules[real]!).exports;
    if (real.endsWith(".json")) {
      const text = host.readFileSync(real, "utf8");
      // Node drops a byte order mark before parsing JSON.
      const exports = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
      // A complete module record, as a bundled load of the file makes.
      const module = newModule(real, parent, (self) => create(host.dirname(real), self));
      module.exports = exports;
      module.loaded = true;
      modules[real] = module;
      return exports;
    }
    if (!isDependency(real)) throw missing(found.relative);
    const name = JSON.stringify(real.slice(real.lastIndexOf(host.sep) + 1));
    if (/\.node$/i.test(real)) {
      throw failure("Native addons are not supported in API routes: " + name, "ERR_DLOPEN_FAILED");
    }
    if (/\.m[jt]s$/i.test(real) || (/\.(?:js|ts)$/i.test(real) && packageType(real) === "module")) {
      throw failure("require() of an ES module is not supported here: " + name, "ERR_REQUIRE_ESM");
    }
    return evaluate(real, parent);
  };
  // Node's `paths` option: each entry is a directory to resolve from, a
  // relative one from the working directory; anything else is an error.
  const findFrom = (id: unknown, directory: string | undefined, options: unknown) => {
    const paths = options !== null && typeof options === "object"
      ? (options as { paths?: unknown }).paths
      : undefined;
    if (paths === undefined) return find(id, directory);
    if (!Array.isArray(paths)) {
      throw failure("The property 'options.paths' is invalid", "ERR_INVALID_ARG_VALUE");
    }
    // As in Node, an absolute id, a `#name` and the caller's own package
    // name resolve from the caller, whatever the paths.
    if (typeof id !== "string") return null;
    if (host.isAbsolute(id) || id.startsWith("#")) return find(id, directory);
    const scope = directory === undefined ? null : packageScope(directory);
    const name = id.split("/").slice(0, id.startsWith("@") ? 2 : 1).join("/");
    if (
      scope != null && !relativeId(id) && scope.manifest.name === name &&
      scope.manifest.exports != null
    ) {
      return findPackage(id, directory!);
    }
    for (const path of paths) {
      if (typeof path !== "string") {
        throw failure("A paths entry must be of type string", "ERR_INVALID_ARG_TYPE");
      }
      const found = find(id, host.isAbsolute(path) ? path : host.join(host.cwd(), path), false);
      if (found !== null) return found;
    }
    return null;
  };
  // The `node_modules` directories a package id is looked up in from
  // `directory`, nearest first, within the project, as Node's `module.paths`.
  const lookupPaths = (directory: string) => {
    const lookups: string[] = [];
    let current = directory;
    while (inProject(current)) {
      if (!current.endsWith(host.sep + "node_modules")) {
        lookups.push(host.join(current, "node_modules"));
      }
      const parent = host.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return lookups;
  };
  // A require() for `directory`; `owner` is the module it belongs to, if any.
  const create = (directory: string | undefined, owner?: () => RuntimeModule) => {
    const require = ((id: unknown) => {
      // A literal require bound to its module names that module as the parent.
      const parent = owner?.() ?? pending ?? active;
      pending = undefined;
      requireString(id, "id");
      if (id === "") {
        throw invalidArgument(
          "The argument 'id' must be a non-empty string. Received ''",
          "ERR_INVALID_ARG_VALUE",
        );
      }
      const module = builtin(id);
      if (module !== undefined) return module;
      const found = find(id, directory);
      if (found === null) throw missing(label(id));
      return load(found, parent);
    }) as RuntimeRequire;
    const resolve = (id: unknown, options?: { paths?: unknown }) => {
      requireString(id, "request");
      if (builtin(id) !== undefined) return id as string;
      // A bundled module's import.meta.resolve asks with this key for its
      // package maps' import conditions.
      const asImport = options !== null && typeof options === "object" &&
        (options as Record<symbol, unknown>)[Symbol.for("veryfront.importConditions")] === true;
      importing = asImport;
      let found: ReturnType<typeof find>;
      try {
        found = findFrom(id, directory, options);
      } finally {
        importing = false;
      }
      if (found === null) throw missing(label(id));
      // For an import, the module's URL, as import.meta.resolve returns it.
      if (asImport) {
        return host.toFileUrl(found.real) + ("suffix" in found ? found.suffix : "");
      }
      // Node returns the real path, which also keys require.cache.
      return found.real;
    };
    // The directories Node would search for `request`: none for a built-in,
    // the module's own for a path, and its `node_modules` chain, within the
    // project, for a package.
    const resolvePaths = (request: unknown) => {
      requireString(request, "request");
      if (builtin(request) !== undefined) return null;
      if (directory === undefined) return [];
      return relativeId(request) ? [directory] : lookupPaths(directory);
    };
    require.resolve = Object.assign(resolve, { paths: resolvePaths });
    require.cache = modules;
    // Code written for webpack; the callback runs at once, as nothing is split.
    require.ensure = (_ids: unknown, callback: (require: RuntimeRequire) => void) => {
      callback(require);
    };
    return require;
  };
  const byDirectory: Record<string, RuntimeRequire> = Object.create(null);
  // Hands back a literal require's result, and drops an owner it left unused,
  // such as for an ES module the bundler loads itself.
  const settle = <T>(value: T) => {
    pending = undefined;
    return value;
  };
  const requireFrom = ((directory: unknown, module?: unknown, bind?: unknown) => {
    // A record of this runtime's for a file in `directory`.
    const own = records.has(module as RuntimeModule) &&
      (module as RuntimeModule).path === directory;
    // `bind`: the bundled literal require that follows belongs to `module`.
    if (bind === true) {
      pending = own ? module as RuntimeModule : undefined;
      return settle;
    }
    if (own) return (module as RuntimeModule).require;
    if (typeof directory !== "string") return create(undefined);
    return byDirectory[directory] ??= create(directory);
  }) as RuntimeRequireBinding["requireFrom"];
  // The real path of each bundled file, by the bundler's key; null when it
  // is not a dependency file.
  const bundledPaths: Record<string, string | null> = Object.create(null);
  const bundledPath = (key: string) => {
    if (key in bundledPaths) return bundledPaths[key]!;
    let real: string | null = null;
    try {
      // The bundler names files relative to its working directory, with
      // symlinks followed; this keys them the way computed requires do.
      const path = host.realpathSync(host.join(bundleRoot!, key));
      if (dependencyPrefixes.some((prefix) => path.startsWith(prefix))) real = path;
    } catch {
      // Not a file path, such as a key in another namespace.
    }
    return bundledPaths[key] = real;
  };
  return {
    // Route code's computed ids resolve from the project, as Node's would.
    require: create(projectRoot),
    requireFrom,
    bundled: (key, body) => {
      // The module whose literal require this is, when it is no longer running.
      const parent = pending ?? active;
      pending = undefined;
      if (bundleRoot === undefined || typeof key !== "string") return null;
      const real = bundledPath(key);
      if (real === null) return null;
      const cached = modules[real];
      if (cached !== undefined) return adopt(parent, cached);
      const module = newModule(real, parent, (self) => create(host.dirname(real), self));
      modules[real] = module;
      const previous = active;
      active = module;
      try {
        body.call(module.exports, module.exports, module);
      } catch (error) {
        drop(module);
        throw error;
      } finally {
        active = previous;
      }
      module.loaded = true;
      return module;
    },
  };
}

// Whether every occurrence of `name` in `code` is a call that dependency
// preparation wrote: `name("...")`, or the `typeof name === "function"` guard.
function onlyHelperCalls(code: string, name: string): boolean {
  const all = code.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
  const calls = code.match(
    new RegExp(`\\b${name}\\("|\\btypeof ${name} === "function"`, "g"),
  )?.length ?? 0;
  return all === calls;
}

// esbuild's helper that runs a bundled CommonJS file once, as esbuild 0.28
// prints it. Its names may carry a numeric suffix, and a direct eval in the
// bundle renames its locals. {@link prependRuntimeRequire} routes it through
// the runtime module cache.
const COMMONJS_HELPER = new RegExp(
  [
    "var (__commonJS\\d*) = \\((\\w+), (\\w+)\\) => function (__require\\d*)\\(\\) \\{\\n",
    "  try \\{\\n",
    "    return \\3 \\|\\| \\(0, \\2\\[(__getOwnPropNames\\d*)\\(\\2\\)\\[0\\]\\]\\)",
    "\\(\\(\\3 = \\{ exports: \\{\\} \\}\\)\\.exports, \\3\\), \\3\\.exports;\\n",
    "  \\} catch \\((\\w+)\\) \\{\\n",
    "    throw \\3 = 0, \\6;\\n",
    "  \\}\\n",
    "\\};",
  ].join(""),
);

/**
 * Binds the module-level `require` that esbuild's output calls for anything it
 * did not bundle, to {@link createRuntimeRequire}. esbuild's ESM output never
 * declares a top-level `require` (it renames a route's own binding of that
 * name), so the prologue cannot collide with route code. Each bundled
 * CommonJS dependency then runs through the runtime module cache; see
 * {@link RuntimeRequireBinding.bundled}. `bundleRoot` is the bundle's working
 * directory, which its file names are relative to.
 */
export async function prependRuntimeRequire(
  code: string,
  projectRoot: string,
  dependencyDirectories: readonly string[],
  bundleRoot: string,
): Promise<string> {
  let prefix = "__vf_runtime";
  while (code.includes(prefix)) prefix += "_";
  // Dependency code calls the helper by a fixed name, which route code may
  // declare too. The prologue binds it under a name the bundle does not use,
  // and only the free references, which are dependency calls, are renamed.
  const requireFrom = `${prefix}_require_from`;
  if (onlyHelperCalls(code, BUNDLED_REQUIRE_FROM)) {
    code = code.replace(new RegExp(`\\b${BUNDLED_REQUIRE_FROM}\\b`, "g"), requireFrom);
  } else {
    // Some other use of the name, such as a declaration in route code: the
    // parser tells free references apart, as the bundler does.
    code = (await transform(code, {
      loader: "js",
      format: "esm",
      platform: "neutral",
      logLevel: "silent",
      define: { [BUNDLED_REQUIRE_FROM]: requireFrom },
    })).code;
  }
  const bundled = `${prefix}_bundled`;
  if (/\bvar __commonJS\d* = /.test(code)) {
    if (!COMMONJS_HELPER.test(code)) {
      // Another bundler version: fail closed rather than run modules twice.
      throw new Error("[API] handler build failed: unexpected CommonJS helper in the bundle");
    }
    code = code.replace(
      COMMONJS_HELPER,
      (
        _whole,
        helper: string,
        cb: string,
        mod: string,
        inner: string,
        ownNames: string,
        error: string,
      ) =>
        [
          `var ${helper} = (${cb}, ${mod}) => function ${inner}() {`,
          `  const key = ${ownNames}(${cb})[0];`,
          `  const managed = ${bundled}(key, ${cb}[key]);`,
          "  if (managed !== null) return managed.exports;",
          "  try {",
          `    return ${mod} || (0, ${cb}[key])((${mod} = { exports: {} }).exports, ${mod}), ${mod}.exports;`,
          `  } catch (${error}) {`,
          `    throw ${mod} = 0, ${error};`,
          "  }",
          "};",
        ].join("\n"),
    );
  }
  const host = [
    `getBuiltinModule: (id) => ${prefix}_process.getBuiltinModule(id)`,
    `isFile: (path) => { try { return ${prefix}_fs.statSync(path).isFile(); } catch { return false; } }`,
    `realpathSync: ${prefix}_fs.realpathSync`,
    `readFileSync: ${prefix}_fs.readFileSync`,
    // Captured now: route code runs after the prologue.
    `compile: ((F) => (source) => new F("exports", "require", "module", "__filename", "__dirname", source))(Function)`,
    `stripTypes: ${prefix}_process.getBuiltinModule("node:module")?.stripTypeScriptTypes`,
    `isAbsolute: ${prefix}_path.isAbsolute`,
    `relative: ${prefix}_path.relative`,
    `join: ${prefix}_path.join`,
    `dirname: ${prefix}_path.dirname`,
    `sep: ${prefix}_path.sep`,
    `toFileUrl: (path) => ${prefix}_url.pathToFileURL(path).href`,
    `cwd: () => ${prefix}_process.cwd()`,
  ];
  const lines = [
    `import ${prefix}_process from "node:process";`,
    `import * as ${prefix}_fs from "node:fs";`,
    `import * as ${prefix}_path from "node:path";`,
    `import * as ${prefix}_url from "node:url";`,
    `const { require, bundled: ${bundled}, requireFrom: ${requireFrom} } = (${createRuntimeRequire.toString()})({ ${
      host.join(", ")
    } }, ${JSON.stringify(projectRoot)}, ${JSON.stringify([...PREFIX_ONLY_BUILTINS])}, ${
      JSON.stringify(dependencyDirectories)
    }, ${JSON.stringify(bundleRoot)});`,
  ];
  // A hashbang is only valid as the first line.
  const hashbangEnd = code.startsWith("#!") ? code.indexOf("\n") + 1 : 0;
  return code.slice(0, hashbangEnd) + lines.join("\n") + "\n" + code.slice(hashbangEnd);
}
