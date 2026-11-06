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
import { build as bundle } from "veryfront/extensions/bundler";
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
 * Resolves the relative imports of dependency files the way Node does: the
 * bundler's extension order serves project code and would load a TypeScript
 * sibling first. Only relative imports differ, so only they are probed, with a
 * few file checks and no second resolution. Must run after
 * {@link createCompiledBuiltinPlugin} and before the project's own resolvers.
 */
export function createDependencyResolvePlugin(
  isDependencyFile: (path: string) => boolean,
  isFile: IsFile,
): Plugin {
  return {
    name: "vf-dependency-resolve",
    setup(build) {
      build.onResolve({ filter: RELATIVE_SPECIFIER }, async (args) => {
        if (!args.importer || !isDependencyFile(args.importer)) return undefined;
        const file = await nodeRelativeFile(args.path, args.resolveDir, isFile);
        return file === null ? undefined : { path: file };
      });
    },
  };
}

/**
 * Keeps the given packages external for `import` and `import()` only. A
 * package that loads from disk as ESM may also export CommonJS to `require`;
 * a `require()` of it from a bundled dependency bundles that CommonJS entry,
 * since the runtime `require` cannot load packages. Must run where esbuild's
 * own resolution would apply: after the project's import map and aliases.
 */
export function createImportExternalsPlugin(names: Iterable<string>): Plugin {
  const escaped = [...names].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const filter = new RegExp(`^(?:${escaped.join("|")})(?:/.*)?$`);
  return {
    name: "vf-import-externals",
    setup(build) {
      if (escaped.length === 0) return;
      build.onResolve(
        { filter },
        (args) =>
          args.kind === "import-statement" || args.kind === "dynamic-import"
            ? { path: args.path, external: true }
            : undefined,
      );
    },
  };
}

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
  const jsExtension = /\.jsx?$/i.test(filePath);
  // Node's require() loads a file without an extension as CommonJS, whatever
  // its package declares; a package `main` may name one.
  const extensionless = pathHelper.extname(filePath) === "";
  if (!cjsExtension && !extensionless && !(jsExtension && packageType !== "module")) return null;

  // The source does not contain the name, so every occurrence in the output
  // is one the parser put there. It never reaches the bundle.
  const marker = await markerFor("__vf_require_resolve_", filePath, contents);
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
  // A call left unresolved throws at runtime, as in Node.
  return rewritten.replaceAll(marker, "require.resolve");
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
): Promise<string> {
  const url = pathHelper.toFileUrl(filePath).href;
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
}

/**
 * A bundled dependency file as Node would run it: see
 * {@link prepareCommonJSFile} and {@link prepareModuleFile}. A literal
 * location resolves at build time only to a file inside the project's
 * dependencies.
 */
export async function prepareDependencyFile(input: DependencyFileInput): Promise<string> {
  const { build, contents, logicalPath, resolvedPath, isDependencyFile } = input;
  // Most package files read none of these names; parsing them would change
  // nothing. The check is textual, so it can only send extra files to the parser.
  const importMeta = /\bimport\.meta\b/.test(contents);
  const readsCommonJSNames = contents.includes("__dirname") ||
    contents.includes("__filename") ||
    (contents.includes("require") && contents.includes("resolve"));
  if (!readsCommonJSNames && !importMeta) return contents;
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
  if (commonJS !== null) return commonJS;
  if (!importMeta) return contents;
  return await prepareModuleFile(contents, logicalPath, async (specifier) => {
    const builtin = builtinModuleName(specifier);
    if (builtin !== undefined) return "node:" + builtin;
    if (/^[a-z][a-z0-9+.-]*:/i.test(specifier) || RELATIVE_SPECIFIER.test(specifier)) {
      return new URL(specifier, pathHelper.toFileUrl(logicalPath)).href;
    }
    const path = await dependencyPath(specifier, "import-statement");
    return path === null ? null : pathHelper.toFileUrl(path).href;
  });
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
  module: { exports: unknown },
  filename: string,
  dirname: string,
) => void;

/** The runtime `require` of a bundled route; see {@link createRuntimeRequire}. */
export interface RuntimeRequire {
  (id: unknown): unknown;
  resolve(id: unknown): string;
  /** webpack's `require.ensure`: everything is loaded already. */
  ensure(ids: unknown, callback: (require: RuntimeRequire) => void): void;
}

/**
 * The `require` that esbuild's output calls for anything it did not bundle:
 * a computed id, or a built-in.
 *
 * - A built-in loads under any id Node accepts.
 * - An absolute path, or a relative one inside a module this loaded, finds a
 *   file in Node's order: the path, then with `.js` or `.json`, then its
 *   `index.js` or `index.json`. A package name inside a module this loaded
 *   is looked up in `node_modules` from that module upwards, through the
 *   package's `exports` (`node`, `require` and `default` conditions) or
 *   `main`. Its real path must be inside the project.
 *   JSON loads anywhere in the project; JavaScript only from the project's
 *   dependencies, as CommonJS, with its own `require`. Each loads once, as in
 *   Node's module cache. `require.resolve` returns the path it found.
 * - Anything else, a package name in route code included, throws
 *   `MODULE_NOT_FOUND`, so optional dependencies probed in a `try` still
 *   fall back.
 * - `require.ensure`, which code written for webpack calls, runs its callback.
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
): RuntimeRequire {
  // Tables without a prototype: `in` reads only their own keys and does not
  // depend on built-ins that route code could replace later.
  const prefixOnly: Record<string, true> = Object.create(null);
  for (const name of prefixOnlyNames) prefixOnly[name] = true;
  const modules: Record<string, { exports: unknown }> = Object.create(null);
  const dependencyPrefixes = dependencyDirectories.map((directory) => directory + host.sep);
  const builtin = (id: unknown) => {
    // A bare prefix-only name such as `test` is an npm package, as in Node.
    if (typeof id !== "string" || id in prefixOnly) return undefined;
    return host.getBuiltinModule(id);
  };
  const missing = (label: string) => {
    const error = new Error("Cannot find module " + JSON.stringify(label)) as Error & {
      code?: string;
    };
    error.code = "MODULE_NOT_FOUND";
    return error;
  };
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
  const relativeId = (id: string) =>
    id === "." || id === ".." || id.startsWith("./") || id.startsWith("../");
  // A file at `base` in Node's order: exact, `.js`, `.json`, then the index.
  const findFile = (base: string) => {
    const candidates = [
      base,
      base + ".js",
      base + ".json",
      host.join(base, "index.js"),
      host.join(base, "index.json"),
    ];
    for (const candidate of candidates) {
      const found = projectFile(candidate);
      if (found !== null) return found;
    }
    return null;
  };
  // The target a package's `exports` gives `require()`: the `node`, `require`
  // and `default` conditions, in the order the package lists them.
  const exportTarget = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const target = exportTarget(item);
        if (target !== null) return target;
      }
      return null;
    }
    if (value === null || typeof value !== "object") return null;
    for (const [condition, item] of Object.entries(value)) {
      if (condition !== "node" && condition !== "require" && condition !== "default") continue;
      const target = exportTarget(item);
      if (target !== null) return target;
    }
    return null;
  };
  // A package's file for `subpath` ("" or "/sub"), as Node's require() picks it.
  const packageFile = (packageDir: string, subpath: string) => {
    const manifestPath = host.join(packageDir, "package.json");
    let manifest: { exports?: unknown; main?: unknown } = {};
    if (host.isFile(manifestPath)) {
      try {
        manifest = JSON.parse(host.readFileSync(manifestPath, "utf8"));
      } catch {
        return null; // Node rejects a malformed package.json
      }
    }
    const exports = manifest.exports;
    if (exports !== undefined && exports !== null) {
      const key = "." + subpath;
      const keyed = typeof exports === "object" && !Array.isArray(exports) &&
        Object.keys(exports).some((name) => name.startsWith("."));
      const entry = keyed
        ? (exports as Record<string, unknown>)[key]
        : key === "."
        ? exports
        : null;
      const target = exportTarget(entry);
      return target === null ? null : projectFile(host.join(packageDir, target));
    }
    if (subpath !== "") return findFile(host.join(packageDir, subpath));
    if (typeof manifest.main === "string") {
      const main = findFile(host.join(packageDir, manifest.main));
      if (main !== null) return main;
    }
    return findFile(packageDir);
  };
  // A package name looked up in `node_modules` from `directory` upwards, as
  // Node's require() does, never above the project.
  const findPackage = (id: string, directory: string) => {
    const parts = id.split("/");
    const nameLength = id.startsWith("@") ? 2 : 1;
    if (
      parts.length < nameLength ||
      parts.some((part) => part === "" || part === "." || part === "..")
    ) {
      return null;
    }
    const name = parts.slice(0, nameLength).join("/");
    const subpath = parts.length > nameLength ? "/" + parts.slice(nameLength).join("/") : "";
    let current = directory;
    for (;;) {
      const relative = host.relative(projectRoot, current);
      if (relative === ".." || relative.startsWith(".." + host.sep) || host.isAbsolute(relative)) {
        return null;
      }
      if (!current.endsWith(host.sep + "node_modules")) {
        const found = packageFile(host.join(current, "node_modules", name), subpath);
        if (found !== null) return found;
      }
      const parent = host.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  };
  const find = (id: unknown, directory: string | undefined) => {
    if (typeof id !== "string") return null;
    if (host.isAbsolute(id)) return findFile(id);
    if (directory === undefined) return null;
    if (relativeId(id)) return findFile(host.join(directory, id));
    return findPackage(id, directory);
  };
  const label = (id: unknown) =>
    typeof id === "string" && (host.isAbsolute(id) || relativeId(id))
      ? "a path outside this project or missing"
      : String(id);
  const evaluate = (real: string) => {
    const module = { exports: {} as unknown };
    modules[real] = module;
    const directory = host.dirname(real);
    const source = host.readFileSync(real, "utf8");
    try {
      // A hashbang is not JavaScript; Node ignores it too.
      host.compile(source.startsWith("#!") ? "//" + source : source, real).call(
        module.exports,
        module.exports,
        create(directory),
        module,
        real,
        directory,
      );
    } catch (error) {
      delete modules[real];
      throw error;
    }
    return module.exports;
  };
  const create = (directory: string | undefined) => {
    const require = ((id: unknown) => {
      const module = builtin(id);
      if (module !== undefined) return module;
      const found = find(id, directory);
      if (found === null) throw missing(label(id));
      if (found.real in modules) return modules[found.real]!.exports;
      if (found.real.endsWith(".json")) {
        const exports = JSON.parse(host.readFileSync(found.real, "utf8"));
        modules[found.real] = { exports };
        return exports;
      }
      if (dependencyPrefixes.some((prefix) => found.real.startsWith(prefix))) {
        return evaluate(found.real);
      }
      throw missing(found.relative);
    }) as RuntimeRequire;
    require.resolve = (id: unknown) => {
      if (builtin(id) !== undefined) return id as string;
      const found = find(id, directory);
      if (found === null) throw missing(label(id));
      return found.path;
    };
    // Code written for webpack; the callback runs at once, as nothing is split.
    require.ensure = (_ids: unknown, callback: (require: RuntimeRequire) => void) => {
      callback(require);
    };
    return require;
  };
  return create(undefined);
}

/**
 * Binds the module-level `require` that esbuild's output calls for anything it
 * did not bundle, to {@link createRuntimeRequire}. esbuild's ESM output never
 * declares a top-level `require` (it renames a route's own binding of that
 * name), so the prologue cannot collide with route code.
 */
export function prependRuntimeRequire(
  code: string,
  projectRoot: string,
  dependencyDirectories: readonly string[],
): string {
  let prefix = "__vf_runtime";
  while (code.includes(prefix)) prefix += "_";
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
    `const require = (${createRuntimeRequire.toString()})({ ${host.join(", ")} }, ${
      JSON.stringify(projectRoot)
    }, ${JSON.stringify([...PREFIX_ONLY_BUILTINS])}, ${JSON.stringify(dependencyDirectories)});`,
  ];
  // A hashbang is only valid as the first line.
  const hashbangEnd = code.startsWith("#!") ? code.indexOf("\n") + 1 : 0;
  return code.slice(0, hashbangEnd) + lines.join("\n") + "\n" + code.slice(hashbangEnd);
}
