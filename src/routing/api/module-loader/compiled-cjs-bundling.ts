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
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";

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
 * the `node` condition and `main`, as Node does; Node never reads `module`.
 * The extension order serves project code, and
 * {@link createDependencyResolvePlugin} restores Node's order inside packages.
 */
export const COMPILED_RESOLVE_OPTIONS = {
  mainFields: ["main"],
  conditions: ["node"],
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
): Promise<string> {
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
      build.onResolve({ filter: RELATIVE_SPECIFIER }, async (args) => {
        if (!args.importer || !isDependencyFile(args.importer)) return undefined;
        const file = await nodeRelativeFile(args.path, args.resolveDir, isFile);
        return file === null ? undefined : { path: file };
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
          return { path: pathHelper.toFileUrl(file).href, external: true };
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
        const type = (JSON.parse(manifest) as { type?: unknown }).type;
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
 * its hashbang, directive prologue and `arguments` are unchanged. Each unbound
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
  // Node's require() loads a file without an extension as CommonJS, whatever
  // its package declares; a package `main` may name one.
  const extensionless = pathHelper.extname(filePath) === "";
  if (!cjsExtension && !extensionless && !(jsExtension && packageType !== "module")) return null;

  // The source does not contain the name, so every occurrence in the output
  // is one the parser put there. It never reaches the bundle.
  const marker = await markerFor("__vf_require_resolve_", filePath, contents);
  const requireMarker = await markerFor("__vf_require_call_", filePath, contents);
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
    },
  });
  const format = Object.values(result.metafile?.inputs ?? {})[0]?.format;
  if (!cjsExtension && format === "esm") return null;
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
  const boundRequire = `(${BUNDLED_REQUIRE_FROM}(${JSON.stringify(directory)}))`;
  // Code in a direct eval sees the file's own bindings, which no rewrite of
  // the source reaches; the file declares them, as Node's wrapper does. Its
  // requires then all run at runtime. A file that assigns to `require` also
  // keeps the name: a call is no assignment target.
  const directEval = /\beval\s*\(/.test(contents);
  const assigned = new RegExp(`${requireMarker}\\s*=(?!=)`).test(rewritten);
  const prepared = rewritten
    .replace(
      literalRequire(requireMarker),
      (_whole, double, single, template) =>
        `require(${JSON.stringify(double ?? single ?? template)})`,
    )
    .replaceAll(marker, `${requireMarker}.resolve`)
    .replaceAll(requireMarker, directEval || assigned ? "require" : boundRequire);
  if (!directEval) return prepared;
  // After a hashbang and the directive prologue, so "use strict" still applies.
  const head = /^(?:#![^\n]*\n)?(?:(["'])[^"'\n]*\1;\n)*/.exec(prepared)?.[0] ?? "";
  const bindings = `var require = ${boundRequire}, __dirname = ${JSON.stringify(directory)}, ` +
    `__filename = ${JSON.stringify(filePath)};\n`;
  return head + bindings + prepared.slice(head.length);
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
 * file and built-ins to their `node:` ids, and throws `ERR_MODULE_NOT_FOUND`
 * for a package name, which the bundle cannot locate at runtime. Any other
 * read of `import.meta` gets an object with these four properties.
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
    },
  });
  const code = result.outputFiles?.[0]?.text;
  if (code === undefined) throw new Error(`No output for dependency file ${filePath}`);
  if (!code.includes(marker)) return code;

  const rewritten = await resolveLiteralCalls(code, marker, resolve);
  if (!rewritten.includes(marker)) return rewritten;
  const prologue = [
    // The resolver is a declaration, so it is hoisted: a cyclic import may
    // call into the file before its body runs.
    `function ${marker}(specifier) {`,
    `  return (${createImportMetaResolve.toString()})(${JSON.stringify(url)}, ${
      JSON.stringify([...PREFIX_ONLY_BUILTINS])
    }, (id) => globalThis.process?.getBuiltinModule?.(id))(specifier);`,
    "}",
    `const ${marker}_meta = { url: ${JSON.stringify(url)}, filename: ${
      JSON.stringify(filePath)
    }, dirname: ${JSON.stringify(pathHelper.dirname(filePath))}, resolve: ${marker} };`,
  ].join("\n");
  // A hashbang is only valid as the first line.
  const hashbangEnd = rewritten.startsWith("#!") ? rewritten.indexOf("\n") + 1 : 0;
  return rewritten.slice(0, hashbangEnd) + prologue + "\n" + rewritten.slice(hashbangEnd);
}

/**
 * The runtime `import.meta.resolve` of a bundled dependency module at
 * `moduleUrl`: URLs and relative paths resolve against the module, built-ins
 * to their `node:` ids, and a package name throws `ERR_MODULE_NOT_FOUND`,
 * since the bundle cannot locate packages at runtime.
 *
 * {@link prepareModuleFile} embeds this function's source in the module, so
 * it must not refer to anything outside its own body.
 */
export function createImportMetaResolve(
  moduleUrl: string,
  prefixOnlyNames: readonly string[],
  getBuiltinModule: (id: string) => unknown,
): (specifier: unknown) => string {
  return (specifier) => {
    const id = String(specifier);
    if (/^[a-z][a-z0-9+.-]*:/i.test(id)) return new URL(id).href;
    if (/^(?:\.\.?(?:\/|$)|\/)/.test(id)) return new URL(id, moduleUrl).href;
    // A bare prefix-only name such as `test` is a package, as in Node.
    if (!prefixOnlyNames.includes(id) && getBuiltinModule(id) !== undefined) return "node:" + id;
    const error = new Error(
      "Cannot find package " + JSON.stringify(id) + " imported from a bundled dependency",
    ) as Error & { code?: string };
    error.code = "ERR_MODULE_NOT_FOUND";
    throw error;
  };
}

/**
 * The name a bundled dependency module registers itself under, so that the
 * runtime `require` shares one module cache with the bundle. The route
 * module's prologue binds it; see {@link prependRuntimeRequire}.
 */
export const BUNDLED_MODULE_REGISTRY = "__vf_register_bundled_module";

/**
 * The name a bundled CommonJS dependency calls for the `require` of its own
 * directory; see {@link RuntimeRequireBinding.requireFrom}.
 */
export const BUNDLED_REQUIRE_FROM = "__vf_require_from";

/**
 * `code` with a last statement that registers its CommonJS `module` by
 * `path`. In an ES module `module` is unbound and nothing happens. A file
 * that leaves early with a top-level `return` is not registered, and a
 * computed `require()` of it runs it again.
 */
export function registerBundledModule(code: string, path: string): string {
  const registry = BUNDLED_MODULE_REGISTRY;
  return `${code}\n;typeof module === "object" && module !== null && ` +
    `typeof ${registry} === "function" && ${registry}(${JSON.stringify(path)}, module);\n`;
}

/**
 * A dependency's JSON file as a CommonJS module that registers itself, so a
 * computed `require()` of the same file returns the same object, as in Node.
 * Malformed JSON fails the build, as the bundler's JSON loader would.
 */
export function prepareDependencyJson(contents: string, path: string): string {
  // Node drops a byte order mark before parsing JSON.
  const json = contents.charCodeAt(0) === 0xfeff ? contents.slice(1) : contents;
  JSON.parse(json);
  return registerBundledModule(`module.exports = JSON.parse(${JSON.stringify(json)});`, path);
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
  const { build, contents, logicalPath, resolvedPath, isDependencyFile } = input;
  // A file Node may load as CommonJS registers its module for the runtime
  // `require`; an ES module has no `module` to register.
  const mayBeCommonJS = /\.c[jt]s$/i.test(logicalPath) ||
    (/(?:\.(?:jsx?|ts)|[\\/][^.\\/]+)$/i.test(logicalPath) && input.packageType !== "module");
  const register = (code: string) =>
    mayBeCommonJS ? registerBundledModule(code, resolvedPath) : code;
  // Most package files read none of these names; parsing them would change
  // nothing. The check is textual, so it can only send extra files to the parser.
  const importMeta = /\bimport\.meta\b/.test(contents);
  const readsCommonJSNames = contents.includes("__dirname") ||
    contents.includes("__filename") ||
    // Any use of require but a call with a string literal, which the bundler
    // bundles: a computed id must resolve from this file's directory.
    /\brequire\b/.test(contents.replace(LITERAL_REQUIRE_CALL, "")) ||
    // A direct eval may read any of them.
    /\beval\s*\(/.test(contents);
  if (!readsCommonJSNames && !importMeta) return register(contents);
  const resolveDir = pathHelper.dirname(resolvedPath);
  const dependencyPath = async (
    specifier: string,
    kind: "require-resolve" | "import-statement",
  ) => {
    if (!build.resolve) return null;
    const result = await build.resolve(specifier, { kind, importer: resolvedPath, resolveDir });
    if (result.errors?.length || !result.path || result.external) return null;
    if (!isDependencyFile(result.path)) return null;
    return await nodePreferredFile(result.path, specifier, resolveDir, input.isFile);
  };
  const commonJS = await prepareCommonJSFile(
    contents,
    logicalPath,
    input.packageType,
    (specifier) => dependencyPath(specifier, "require-resolve"),
  );
  if (commonJS !== null) return registerBundledModule(commonJS, resolvedPath);
  if (!importMeta) return contents;
  const moduleUrl = pathHelper.toFileUrl(logicalPath).href + (input.suffix ?? "");
  return await prepareModuleFile(contents, logicalPath, async (specifier) => {
    const builtin = builtinModuleName(specifier);
    if (builtin !== undefined) return "node:" + builtin;
    // A `#name` resolves through the package's own `imports`, below.
    if (URL_SPECIFIER.test(specifier) || RELATIVE_SPECIFIER.test(specifier)) {
      return new URL(specifier, moduleUrl).href;
    }
    const path = await dependencyPath(specifier, "import-statement");
    return path === null ? null : pathHelper.toFileUrl(path).href;
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
  loaded: boolean;
  children: unknown[];
  require: RuntimeRequire;
}

/** {@link createRuntimeRequire}'s result. */
export interface RuntimeRequireBinding {
  readonly require: RuntimeRequire;
  /**
   * Records a module the bundler bundled, by real path, so that a computed
   * `require()` of the same file returns it instead of running it again.
   */
  readonly register: (path: string, module: { exports: unknown }) => void;
  /**
   * The `require` of a bundled dependency file in `directory`, for the calls
   * the bundler left to runtime, such as a computed relative id.
   */
  readonly requireFrom: (directory: unknown) => RuntimeRequire;
}

/** The runtime `require` of a bundled route; see {@link createRuntimeRequire}. */
export interface RuntimeRequire {
  (id: unknown): unknown;
  /** Node's `require.resolve`, including its `paths` option. */
  resolve(id: unknown, options?: { paths?: unknown }): string;
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
 *   `default` conditions) or its `main`. A `#name` reads the `imports` of the
 *   package that holds the module.
 *
 * Whatever it finds must have its real path inside the project, and nothing
 * looks above it. JSON loads from anywhere in the project. JavaScript loads
 * only from the project's dependencies, as CommonJS, with its own `require`
 * and `module`. A native addon or an ES module throws. Each file loads once,
 * and a module the bundle already ran is the same module; see
 * {@link RuntimeRequireBinding.register}. `require.cache` holds them by real
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
): RuntimeRequireBinding {
  // Tables without a prototype: `in` reads only their own keys and does not
  // depend on built-ins that route code could replace later.
  const prefixOnly: Record<string, true> = Object.create(null);
  for (const name of prefixOnlyNames) prefixOnly[name] = true;
  const modules: Record<string, { exports: unknown }> = Object.create(null);
  const failure = (message: string, code: string) => {
    const error = new Error(message) as Error & { code?: string };
    error.code = code;
    return error;
  };
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
    if (manifest === null) return null;
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
      if (condition !== "node" && condition !== "require" && condition !== "default") continue;
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
  const readManifest = (packageDir: string): Record<string, unknown> | null | undefined => {
    const manifestPath = host.join(packageDir, "package.json");
    if (!host.isFile(manifestPath)) return undefined;
    try {
      const manifest = JSON.parse(host.readFileSync(manifestPath, "utf8"));
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
    return segments === null ? null : projectFile(host.join(packageDir, ...segments));
  };
  const validExport = (target: string) => targetSegments(target) !== null;
  // An `imports` target may also name a package.
  const validImport = (target: string) =>
    validExport(target) ||
    !(target.startsWith(".") || target.startsWith("/") || target.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(target));
  // The `type` of the package.json that scopes a file, as Node reads it: the
  // nearest one, never past a `node_modules` directory or the project.
  const packageType = (file: string) => {
    let current = host.dirname(file);
    while (inProject(current) && !current.endsWith(host.sep + "node_modules")) {
      const manifest = readManifest(current);
      if (manifest !== undefined) return manifest?.type;
      const parent = host.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
    return undefined;
  };
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
    if (manifest === null) return false;
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
  const findPackage = (id: string, directory: string) => {
    const parts = id.split("/");
    const nameLength = id.startsWith("@") ? 2 : 1;
    if (
      parts.length < nameLength ||
      parts.some((part) =>
        part === "" || part === "." || part === ".." ||
        // A Windows separator would let the name walk out of node_modules.
        (host.sep !== "/" && part.includes(host.sep))
      )
    ) {
      return null;
    }
    const name = parts.slice(0, nameLength).join("/");
    const subpath = parts.length > nameLength ? "/" + parts.slice(nameLength).join("/") : "";
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
  // A `#name` from the `imports` of the package that holds `directory`.
  const packageImport = (id: string, directory: string) => {
    let current = directory;
    while (inProject(current)) {
      const manifest = readManifest(current);
      if (manifest !== undefined) {
        const imports = manifest?.imports;
        if (imports === null || typeof imports !== "object" || Array.isArray(imports)) return null;
        const target = mapTarget(imports as Record<string, unknown>, id, validImport);
        if (target === null) return null;
        if (target.startsWith("./")) return packageTarget(current, target);
        return target.startsWith("#") || target.startsWith("/") || target.startsWith(".")
          ? null
          : findPackage(target, current);
      }
      const parent = host.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
    return null;
  };
  const find = (id: unknown, directory: string | undefined) => {
    if (typeof id !== "string") return null;
    if (host.isAbsolute(id)) return findFile(id);
    if (directory === undefined) return null;
    if (relativeId(id)) return findFile(host.join(directory, id));
    if (id.startsWith("#")) return packageImport(id, directory);
    return findPackage(id, directory);
  };
  const label = (id: unknown) =>
    typeof id === "string" && (host.isAbsolute(id) || relativeId(id))
      ? "a path outside this project or missing"
      : String(id);
  const evaluate = (real: string) => {
    const directory = host.dirname(real);
    const require = create(directory);
    const module: RuntimeModule = {
      exports: {},
      id: real,
      filename: real,
      path: directory,
      loaded: false,
      children: [],
      require,
    };
    modules[real] = module;
    const source = host.readFileSync(real, "utf8");
    try {
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
      delete modules[real];
      throw error;
    }
    module.loaded = true;
    return module.exports;
  };
  const isDependency = (real: string) =>
    dependencyPrefixes.some((prefix) => real.startsWith(prefix));
  const load = (found: { real: string; relative: string }) => {
    const real = found.real;
    if (real in modules) return modules[real]!.exports;
    if (real.endsWith(".json")) {
      const text = host.readFileSync(real, "utf8");
      // Node drops a byte order mark before parsing JSON.
      const exports = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
      modules[real] = { exports };
      return exports;
    }
    if (!isDependency(real)) throw missing(found.relative);
    const name = JSON.stringify(real.slice(real.lastIndexOf(host.sep) + 1));
    if (/\.node$/i.test(real)) {
      throw failure("Native addons are not supported in API routes: " + name, "ERR_DLOPEN_FAILED");
    }
    if (/\.m[jt]s$/i.test(real) || (/\.js$/i.test(real) && packageType(real) === "module")) {
      throw failure("require() of an ES module is not supported here: " + name, "ERR_REQUIRE_ESM");
    }
    return evaluate(real);
  };
  // Node's `paths` option: each entry is a directory to resolve from.
  const findFrom = (id: unknown, directory: string | undefined, options: unknown) => {
    const paths = options !== null && typeof options === "object"
      ? (options as { paths?: unknown }).paths
      : undefined;
    if (!Array.isArray(paths)) return find(id, directory);
    for (const path of paths) {
      if (typeof path !== "string" || !host.isAbsolute(path)) continue;
      const found = find(id, path);
      if (found !== null) return found;
    }
    return null;
  };
  const create = (directory: string | undefined) => {
    const require = ((id: unknown) => {
      const module = builtin(id);
      if (module !== undefined) return module;
      const found = find(id, directory);
      if (found === null) throw missing(label(id));
      return load(found);
    }) as RuntimeRequire;
    require.resolve = (id: unknown, options?: { paths?: unknown }) => {
      if (builtin(id) !== undefined) return id as string;
      const found = findFrom(id, directory, options);
      if (found === null) throw missing(label(id));
      // Node returns the real path, which also keys require.cache.
      return found.real;
    };
    require.cache = modules;
    // Code written for webpack; the callback runs at once, as nothing is split.
    require.ensure = (_ids: unknown, callback: (require: RuntimeRequire) => void) => {
      callback(require);
    };
    return require;
  };
  const byDirectory: Record<string, RuntimeRequire> = Object.create(null);
  return {
    // Route code's computed ids resolve from the project, as Node's would.
    require: create(projectRoot),
    requireFrom: (directory) => {
      if (typeof directory !== "string") return create(undefined);
      return byDirectory[directory] ??= create(directory);
    },
    // The bundler names files by their real path; this keys the module the
    // same way even where a symlink above the project was kept.
    register: (path, module) => {
      let real = path;
      try {
        real = host.realpathSync(path);
      } catch {
        // A file the bundler read is there; keep its own name if it is not.
      }
      if (!(real in modules)) modules[real] = module;
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

/**
 * Binds the module-level `require` that esbuild's output calls for anything it
 * did not bundle, to {@link createRuntimeRequire}. esbuild's ESM output never
 * declares a top-level `require` (it renames a route's own binding of that
 * name), so the prologue cannot collide with route code.
 */
export async function prependRuntimeRequire(
  code: string,
  projectRoot: string,
  dependencyDirectories: readonly string[],
): Promise<string> {
  let prefix = "__vf_runtime";
  while (code.includes(prefix)) prefix += "_";
  // Dependency code calls the helpers by fixed names, which route code may
  // declare too. The prologue binds them under names the bundle does not use,
  // and only the free references, which are dependency calls, are renamed.
  const registry = `${prefix}_register`;
  const requireFrom = `${prefix}_require_from`;
  const helpers: Record<string, string> = {
    [BUNDLED_MODULE_REGISTRY]: registry,
    [BUNDLED_REQUIRE_FROM]: requireFrom,
  };
  if (Object.keys(helpers).every((name) => onlyHelperCalls(code, name))) {
    for (const [name, local] of Object.entries(helpers)) {
      code = code.replace(new RegExp(`\\b${name}\\b`, "g"), local);
    }
  } else {
    // Some other use of a helper's name, such as a declaration in route code:
    // the parser tells free references apart, as the bundler does.
    code = (await transform(code, {
      loader: "js",
      format: "esm",
      platform: "neutral",
      logLevel: "silent",
      define: helpers,
    })).code;
  }
  const host = [
    `getBuiltinModule: (id) => ${prefix}_process.getBuiltinModule(id)`,
    `isFile: (path) => { try { return ${prefix}_fs.statSync(path).isFile(); } catch { return false; } }`,
    `realpathSync: ${prefix}_fs.realpathSync`,
    `readFileSync: ${prefix}_fs.readFileSync`,
    // Captured now: route code runs after the prologue.
    `compile: ((F) => (source) => new F("exports", "require", "module", "__filename", "__dirname", source))(Function)`,
    `isAbsolute: ${prefix}_path.isAbsolute`,
    `relative: ${prefix}_path.relative`,
    `join: ${prefix}_path.join`,
    `dirname: ${prefix}_path.dirname`,
    `sep: ${prefix}_path.sep`,
  ];
  const lines = [
    `import ${prefix}_process from "node:process";`,
    `import * as ${prefix}_fs from "node:fs";`,
    `import * as ${prefix}_path from "node:path";`,
    `const { require, register: ${registry}, requireFrom: ${requireFrom} } = (${createRuntimeRequire.toString()})({ ${
      host.join(", ")
    } }, ${JSON.stringify(projectRoot)}, ${JSON.stringify([...PREFIX_ONLY_BUILTINS])}, ${
      JSON.stringify(dependencyDirectories)
    });`,
  ];
  // A hashbang is only valid as the first line.
  const hashbangEnd = code.startsWith("#!") ? code.indexOf("\n") + 1 : 0;
  return code.slice(0, hashbangEnd) + lines.join("\n") + "\n" + code.slice(hashbangEnd);
}
