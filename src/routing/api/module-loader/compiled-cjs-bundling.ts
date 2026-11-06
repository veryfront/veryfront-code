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
 * - `__dirname` and `__filename` are not defined in an ES module, so
 *   {@link wrapCommonJSPaths} passes them to each CommonJS file that reads
 *   them, as Node's CommonJS wrapper does.
 * - `require.resolve("literal")` is resolved at build time to the file's path
 *   on disk ({@link rewriteStaticRequireResolve}). What is left for runtime, a
 *   computed `require()` or `require.resolve()`, gets built-ins, existing
 *   project paths and JSON files; anything else throws `MODULE_NOT_FOUND`.
 * - A native addon cannot be bundled or loaded; the build rejects it with a
 *   clear message rather than an esbuild loader error.
 *
 * @module routing/api/module-loader/compiled-cjs-bundling
 */
import { builtinModules } from "node:module";
import type { Plugin, PluginBuild } from "veryfront/extensions/bundler";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";
import { toFileUrl } from "#veryfront/compat/path";

// Names Node accepts only with the `node:` prefix. A bare `test` is an npm package.
const PREFIX_ONLY_BUILTINS = new Set(["test", "test/reporters", "sqlite", "sea"]);
const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

/** The built-in module a specifier names, without its `node:` prefix. */
export function builtinModuleName(specifier: string): string | undefined {
  if (specifier.startsWith("node:")) {
    const name = specifier.slice(5);
    return BUILTINS.has(name) || PREFIX_ONLY_BUILTINS.has(name) ? name : undefined;
  }
  if (PREFIX_ONLY_BUILTINS.has(specifier)) return undefined;
  return BUILTINS.has(specifier) ? specifier : undefined;
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
      build.onResolve({ filter: /\.node$/ }, (args) => ({
        errors: [{
          text: `Native addons are not supported in API routes: ${JSON.stringify(args.path)}`,
        }],
      }));
    },
  };
}

// An `export` statement; the module lexer reports only imports.
const EXPORT_STATEMENT =
  /(?:^|[;}\n])\s*export\s*(?:default\b|[{*]|(?:async\s+)?function\b|class\b|const\b|let\b|var\b)/;

/**
 * Whether Node would load a dependency file as CommonJS: a `.cjs` file, or a
 * `.js` file outside a `"type": "module"` package scope that has no ESM syntax.
 * esbuild bundles ESM syntax in a `.js` file as ESM whatever the package says.
 */
export async function isCommonJSFile(
  contents: string,
  filePath: string,
  packageType: string | undefined,
): Promise<boolean> {
  if (/\.cjs$/i.test(filePath)) return true;
  if (!/\.js$/i.test(filePath) || packageType === "module") return false;
  if (EXPORT_STATEMENT.test(contents)) return false;
  try {
    // A static import (d === -1) or import.meta (d === -2) is ESM syntax.
    return !(await parseImports(contents)).some((specifier) => specifier.d < 0);
  } catch {
    // expected: the lexer rejects some valid scripts; Node's rule decides.
    return true;
  }
}

/**
 * Passes `__dirname` and `__filename` to a CommonJS file that reads them, as
 * Node's module wrapper does: as parameters of a function around the file, so a
 * file's own `var __dirname` still shadows them and its directive prologue
 * ("use strict") stays first in that function. A hashbang stays first in the
 * file. Top-level `this` is passed through, which esbuild maps to `exports`.
 */
export function wrapCommonJSPaths(contents: string, filePath: string): string {
  if (!/\b__(?:dirname|filename)\b/.test(contents)) return contents;
  const hashbangEnd = contents.startsWith("#!") ? contents.indexOf("\n") + 1 || contents.length : 0;
  const dir = filePath.slice(0, Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")));
  return contents.slice(0, hashbangEnd) +
    "(function (__dirname, __filename) {" + contents.slice(hashbangEnd) +
    `\n}).call(this, ${JSON.stringify(dir)}, ${JSON.stringify(filePath)});\n`;
}

const STATIC_REQUIRE_RESOLVE = /(^|[^\w$.])require\.resolve\(\s*(["'])([^"'\\\n]+)\2\s*\)/g;

/**
 * Replaces each `require.resolve("literal")` that resolves at build time with
 * the string Node would return: the resolved file path, or the id itself for a
 * built-in. One that does not resolve is left for runtime, where it throws
 * `MODULE_NOT_FOUND` as Node does, so an optional dependency probed this way
 * still falls back.
 */
export async function rewriteStaticRequireResolve(
  contents: string,
  resolve: (specifier: string) => Promise<string | null>,
): Promise<string> {
  if (!contents.includes("require.resolve")) return contents;
  const resolved = new Map<string, string | null>();
  for (const match of contents.matchAll(STATIC_REQUIRE_RESOLVE)) {
    const specifier = match[3]!;
    if (!resolved.has(specifier)) {
      resolved.set(
        specifier,
        builtinModuleName(specifier) === undefined ? await resolve(specifier) : specifier,
      );
    }
  }
  return contents.replace(
    STATIC_REQUIRE_RESOLVE,
    (whole, before: string, _q, specifier: string) => {
      const target = resolved.get(specifier);
      return typeof target === "string" ? before + JSON.stringify(target) : whole;
    },
  );
}

/** Input for {@link prepareDependencyFile}. */
export interface DependencyFileInput {
  readonly build: PluginBuild;
  readonly contents: string;
  /** The file's path as the project sees it. */
  readonly logicalPath: string;
  /** The path the bundler resolved, used as the importer for resolution. */
  readonly resolvedPath: string;
  /** The `type` field of the package.json nearest the file. */
  readonly packageType: string | undefined;
  readonly isDependencyFile: (path: string) => boolean;
  /** Points a module's `import.meta` locations at its own URL. */
  readonly rewriteImportMeta: (contents: string, moduleUrl: string) => Promise<string>;
}

/**
 * A bundled dependency file as Node would run it. In a CommonJS file,
 * `require.resolve("literal")` becomes the path the bundler resolves inside
 * the project's dependencies, and `__dirname`/`__filename` are passed in as
 * Node's wrapper passes them. An ESM file keeps its own semantics; only its
 * `import.meta` locations are pointed at the file's own URL.
 */
export async function prepareDependencyFile(input: DependencyFileInput): Promise<string> {
  const { build, contents, logicalPath, resolvedPath, isDependencyFile } = input;
  if (!await isCommonJSFile(contents, logicalPath, input.packageType)) {
    return /\bimport\.meta\b/.test(contents)
      ? await input.rewriteImportMeta(contents, toFileUrl(logicalPath).href)
      : contents;
  }
  const resolveDir = resolvedPath.slice(
    0,
    Math.max(resolvedPath.lastIndexOf("/"), resolvedPath.lastIndexOf("\\")),
  );
  const resolved = await rewriteStaticRequireResolve(contents, async (specifier) => {
    if (!build.resolve) return null;
    const result = await build.resolve(specifier, {
      kind: "require-resolve",
      importer: resolvedPath,
      resolveDir,
    });
    // Only a file inside the project's dependencies is a path to hand back.
    if (result.errors?.length || !result.path || result.external) return null;
    return isDependencyFile(result.path) ? result.path : null;
  });
  return wrapCommonJSPaths(resolved, logicalPath);
}

/**
 * Binds the module-level `require` that esbuild's output calls for anything it
 * did not bundle: the built-ins recorded during the build, and, for a computed
 * id, an existing file inside the project, which `require.resolve` returns and
 * `require` loads when it is JSON. Anything else throws `MODULE_NOT_FOUND`, so
 * optional dependencies probed in a `try` still fall back. Errors name a path
 * relative to the project, never the host path. esbuild renames route bindings
 * named `require`, so the prologue cannot collide with route code.
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
  // Every id Node's require.resolve returns unchanged: a bare built-in name, or
  // any built-in, prefix-only ones included, with the node: prefix.
  const builtinIds = [
    ...BUILTINS,
    ...[...BUILTINS, ...PREFIX_ONLY_BUILTINS].map((name) => "node:" + name),
  ].map((id) => JSON.stringify(id) + ": 1");
  lines.push(
    // The table has no prototype, so `in` reads only its own keys and does
    // not depend on built-ins route code could replace.
    `const ${prefix}s = { ${fields.join(", ")} };`,
    `const ${prefix}_ids = { __proto__: null, ${builtinIds.join(", ")} };`,
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
    `  if (file !== null && file.real.endsWith(".json")) return JSON.parse(${prefix}_fs.readFileSync(file.real, "utf8"));`,
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
