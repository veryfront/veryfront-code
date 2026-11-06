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

function nativeAddonError(path: string) {
  return {
    errors: [{
      text: `Native addons are not supported in API routes: ${JSON.stringify(path)}`,
    }],
  };
}

/**
 * Keeps built-ins external and records each one a bundled module `require`s,
 * so {@link prependRuntimeRequire} can bind it. Must run before any plugin
 * that resolves built-ins itself.
 */
export function createCompiledBuiltinPlugin(requiredBuiltins: Set<string>): Plugin {
  return {
    name: "vf-compiled-builtins",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const name = builtinModuleName(args.path);
        if (name === undefined) return undefined;
        if (args.kind === "require-call") {
          requiredBuiltins.add(args.path);
          return { path: args.path, external: true };
        }
        return { path: `node:${name}`, external: true };
      });
      build.onResolve({ filter: NATIVE_ADDON }, (args) => nativeAddonError(args.path));
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
  if (!relative || NODE_REQUIRE_EXTENSIONS.includes(extension)) return resolvedPath;
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
        if (file === null) return undefined;
        if (NATIVE_ADDON.test(file)) return nativeAddonError(args.path);
        return { path: file };
      });
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
  readonly #root: string;

  constructor(private readonly readManifest: ReadManifest, projectDir: string) {
    this.#root = pathHelper.resolve(projectDir);
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
    if (parent === directory || !isWithinDirectory(this.#root, parent)) return undefined;
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

async function directoryNames(fs: DependencyRootFileSystem, path: string) {
  const names: { name: string; isDirectory: boolean; isSymlink?: boolean }[] = [];
  try {
    for await (const entry of fs.readDir(path)) names.push(entry);
  } catch {
    // expected: no such directory, as for an adapter-backed project
  }
  return names;
}

/**
 * Whether a path the bundler resolved is an installed dependency's file: a
 * file under the project's `node_modules`, under either the given or the
 * canonical root (esbuild reports paths with symlinks followed), or under a
 * workspace package that `node_modules` links to inside the project.
 */
export async function createDependencyFilePredicate(
  projectDir: string,
  fs: DependencyRootFileSystem,
): Promise<(path: string) => boolean> {
  const given = pathHelper.resolve(projectDir);
  let canonical: string | null = null;
  try {
    canonical = await fs.realPath(given);
  } catch {
    // expected: an adapter-backed project may have no host directory
  }
  const prefixes = new Set(
    [given, canonical ?? given].map((root) =>
      pathHelper.join(root, "node_modules") + pathHelper.sep
    ),
  );

  if (canonical !== null) {
    const modules = pathHelper.join(canonical, "node_modules");
    const links: string[] = [];
    for (const entry of await directoryNames(fs, modules)) {
      const path = pathHelper.join(modules, entry.name);
      // Only a link can point outside node_modules; a host that does not say
      // whether an entry is one gets every entry checked.
      if (!entry.name.startsWith("@")) {
        if (entry.isSymlink !== false) links.push(path);
        continue;
      }
      for (const scoped of await directoryNames(fs, path)) {
        if (scoped.isSymlink !== false) links.push(pathHelper.join(path, scoped.name));
      }
    }
    for (const link of links) {
      let target: string;
      try {
        target = await fs.realPath(link);
      } catch {
        continue; // expected: a dangling link
      }
      // A package linked to a directory of the project itself, as npm, Yarn
      // and pnpm workspaces do. The project root and node_modules never count.
      if (
        target !== link && target !== canonical && isWithinDirectory(canonical, target) &&
        !isWithinDirectory(modules, target)
      ) {
        prefixes.add(target + pathHelper.sep);
      }
    }
  }

  const roots = [...prefixes];
  return (path) => {
    if (path === "") return false;
    const resolved = pathHelper.resolve(path);
    return roots.some((prefix) => resolved.startsWith(prefix));
  };
}

/** Resolves a `require.resolve` literal to a path, or null to leave it for runtime. */
export type ResolveRequireLiteral = (specifier: string) => Promise<string | null>;

/**
 * A dependency file as Node would run it when Node loads it as CommonJS, or
 * null when Node loads it as ESM: a `.mjs` file, a `.js` file in a
 * `"type": "module"` package, or a `.js` file with ESM syntax, which esbuild
 * bundles as ESM whatever its package says.
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
  const cjsExtension = /\.cjs$/i.test(filePath);
  const jsExtension = /\.js$/i.test(filePath);
  if (!cjsExtension && !(jsExtension && packageType !== "module")) return null;

  // A fresh name per file: the source cannot contain it, so every occurrence
  // in the output is one the parser put there. It never reaches the bundle.
  const marker = `__vf_require_resolve_${crypto.randomUUID().replaceAll("-", "")}`;
  const result = await bundle({
    stdin: { contents, loader: "js", sourcefile: filePath },
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
  if (jsExtension && format === "esm") return null;
  const code = result.outputFiles?.[0]?.text;
  if (code === undefined) throw new Error(`No output for dependency file ${filePath}`);

  const literalCall = new RegExp(`${marker}\\((["'])([^"'\\\\\\n]*)\\1\\)`, "g");
  const resolved = new Map<string, string | null>();
  for (const match of code.matchAll(literalCall)) {
    const specifier = match[2]!;
    if (!resolved.has(specifier)) {
      resolved.set(
        specifier,
        builtinModuleName(specifier) === undefined ? await resolve(specifier) : specifier,
      );
    }
  }
  return code
    .replace(literalCall, (_whole, _quote, specifier: string) => {
      const target = resolved.get(specifier);
      return typeof target === "string"
        ? JSON.stringify(target)
        : `require.resolve(${JSON.stringify(specifier)})`;
    })
    .replaceAll(marker, "require.resolve");
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
  /** Points a module's `import.meta` locations at its own URL. */
  readonly rewriteImportMeta: (contents: string, moduleUrl: string) => Promise<string>;
}

/**
 * A bundled dependency file as Node would run it: see
 * {@link prepareCommonJSFile}. In a CommonJS file a `require.resolve` literal
 * resolves only to a file inside the project's dependencies. An ESM file keeps
 * its own semantics; only its `import.meta` locations point at its own URL.
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
  const commonJS = await prepareCommonJSFile(
    contents,
    logicalPath,
    input.packageType,
    async (specifier) => {
      if (!build.resolve) return null;
      const result = await build.resolve(specifier, {
        kind: "require-resolve",
        importer: resolvedPath,
        resolveDir,
      });
      // Only a file inside the project's dependencies is a path to hand back.
      if (result.errors?.length || !result.path || result.external) return null;
      if (!isDependencyFile(result.path)) return null;
      return await nodePreferredFile(result.path, specifier, resolveDir, input.isFile);
    },
  );
  if (commonJS !== null) return commonJS;
  return importMeta
    ? await input.rewriteImportMeta(contents, pathHelper.toFileUrl(logicalPath).href)
    : contents;
}

/**
 * Binds the module-level `require` that esbuild's output calls for anything it
 * did not bundle: the built-ins recorded during the build, and, for a computed
 * id, an existing file inside the project, which `require.resolve` returns and
 * `require` loads when it is JSON. Anything else throws `MODULE_NOT_FOUND`, so
 * optional dependencies probed in a `try` still fall back. Errors name a path
 * relative to the project, never the host path. esbuild's ESM output never
 * declares a top-level `require` (it renames a route's own binding of that
 * name), so the prologue cannot collide with route code.
 */
export function prependRuntimeRequire(
  code: string,
  requiredBuiltins: Iterable<string>,
  projectRoot: string,
): string {
  // A fixed order keeps the output byte-identical for the same set of ids.
  const ids = [...requiredBuiltins].sort((a, b) => a.localeCompare(b, "en"));
  let prefix = "__vf_builtin";
  while (code.includes(prefix)) prefix += "_";

  const lines = [
    `import * as ${prefix}_fs from "node:fs";`,
    `import * as ${prefix}_path from "node:path";`,
  ];
  for (const [index, id] of ids.entries()) {
    const specifier = JSON.stringify("node:" + builtinModuleName(id));
    lines.push(`import * as ${prefix}${index} from ${specifier};`);
  }
  const fields = ["__proto__: null"];
  for (const [index, id] of ids.entries()) {
    fields.push(`${JSON.stringify(id)}: ${prefix}${index}.default ?? ${prefix}${index}`);
  }
  const root = JSON.stringify(projectRoot);
  // Every id Node's require.resolve returns unchanged: a built-in Node accepts
  // without the prefix, or any built-in with the node: prefix.
  const builtinIds = [
    ...BUILTINS,
    ...[...BUILTINS, ...PREFIX_ONLY_BUILTINS].map((name) => "node:" + name),
  ].map((id) => JSON.stringify(id) + ": 1");
  lines.push(
    // The table has no prototype, so `in` reads only its own keys and does
    // not depend on built-ins route code could replace.
    `const ${prefix}s = { ${fields.join(", ")} };`,
    `const ${prefix}_ids = { __proto__: null, ${builtinIds.join(", ")} };`,
    // JSON a computed require() loaded, by real path, as Node's module cache keeps it.
    `const ${prefix}_json = { __proto__: null };`,
    `const ${prefix}_missing = (label) => {`,
    '  const error = new Error("Cannot find module " + JSON.stringify(label));',
    '  error.code = "MODULE_NOT_FOUND";',
    "  return error;",
    "};",
    // A path is usable only when it exists and its real path is in the project.
    `const ${prefix}_file = (id) => {`,
    `  if (typeof id !== "string" || !${prefix}_path.isAbsolute(id)) return null;`,
    "  let real;",
    `  try { real = ${prefix}_fs.realpathSync(id); } catch { return null; }`,
    `  const relative = ${prefix}_path.relative(${root}, real);`,
    `  const up = relative === ".." || relative.startsWith(".." + ${prefix}_path.sep);`,
    `  if (relative === "" || up || ${prefix}_path.isAbsolute(relative)) return null;`,
    "  return { real, relative };",
    "};",
    `const ${prefix}_label = (id) => typeof id === "string" && ${prefix}_path.isAbsolute(id) ? "a path outside this project or missing" : String(id);`,
    "const require = (id) => {",
    `  if (typeof id === "string" && id in ${prefix}s) return ${prefix}s[id];`,
    `  const file = ${prefix}_file(id);`,
    `  if (file !== null && file.real.endsWith(".json")) {`,
    `    if (!(file.real in ${prefix}_json)) ${prefix}_json[file.real] = JSON.parse(${prefix}_fs.readFileSync(file.real, "utf8"));`,
    `    return ${prefix}_json[file.real];`,
    "  }",
    `  throw ${prefix}_missing(file !== null ? file.relative : ${prefix}_label(id));`,
    "};",
    "require.resolve = (id) => {",
    `  if (typeof id === "string" && (id in ${prefix}s || id in ${prefix}_ids)) return id;`,
    `  const file = ${prefix}_file(id);`,
    "  if (file !== null) return id;",
    `  throw ${prefix}_missing(${prefix}_label(id));`,
    "};",
  );

  // A hashbang is only valid as the first line.
  const hashbangEnd = code.startsWith("#!") ? code.indexOf("\n") + 1 : 0;
  return code.slice(0, hashbangEnd) + lines.join("\n") + "\n" + code.slice(hashbangEnd);
}
