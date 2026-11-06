/**
 * CommonJS dependencies of an API route in the compiled binary.
 *
 * A compiled binary cannot load a CommonJS file from disk at runtime: Deno's
 * `require` there reads only the files embedded at compile time, and importing
 * a `.cjs` file evaluates it as ESM. So the route build bundles a project's
 * CommonJS dependencies into the route module itself, and esbuild supplies Node
 * resolution and interop. Three pieces keep the bundled code runnable:
 *
 * - A `require()` of a built-in stays external. esbuild emits it as a call to
 *   the module's free `require`, which {@link prependBuiltinRequire} binds to
 *   built-ins imported statically, so nothing loads `node:module` at runtime.
 * - `__dirname` and `__filename` are not defined in an ES module, so
 *   {@link commonJSPathPrelude} defines them for each bundled file that uses
 *   them, as Node's CommonJS wrapper would.
 * - A native addon cannot be bundled or loaded; the build rejects it with a
 *   clear message rather than an esbuild loader error.
 *
 * @module routing/api/module-loader/compiled-cjs-bundling
 */
import { builtinModules } from "node:module";
import type { Plugin } from "veryfront/extensions/bundler";

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
 * so {@link prependBuiltinRequire} can bind it. Must run before any plugin
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

const DECLARES_PATH_BINDING =
  /\b(?:var|let|const|function|class)\s+(?:__dirname|__filename)\b|\bimport\s[^;]*\b(?:__dirname|__filename)\b/;

/**
 * Declarations of `__dirname` and `__filename` for a bundled dependency file
 * that reads them without declaring them, or "" when it needs none. esbuild
 * wraps each CommonJS file in its own function, so the values stay per file.
 */
export function commonJSPathPrelude(contents: string, filePath: string): string {
  const usesDirname = /\b__dirname\b/.test(contents);
  const usesFilename = /\b__filename\b/.test(contents);
  if (!usesDirname && !usesFilename) return "";
  if (DECLARES_PATH_BINDING.test(contents)) return "";
  const dir = filePath.slice(0, Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")));
  return `var __dirname = ${JSON.stringify(dir)}, __filename = ${JSON.stringify(filePath)};\n`;
}

/**
 * Binds the module-level `require` that esbuild's output calls for an external
 * `require()` to the built-ins recorded during the build. Any other id throws
 * the error Node gives for a missing module, so optional dependencies probed
 * in a `try` still fall back. esbuild renames route bindings named `require`,
 * so the prologue cannot collide with route code.
 */
export function prependBuiltinRequire(code: string, requiredBuiltins: Iterable<string>): string {
  // A fixed order keeps the output byte-identical for the same set of ids.
  const ids = [...requiredBuiltins].sort((a, b) => a.localeCompare(b, "en"));
  let prefix = "__vf_builtin";
  while (code.includes(prefix)) prefix += "_";

  const lines = ids.map((id, index) => {
    const specifier = JSON.stringify("node:" + builtinModuleName(id));
    return `import * as ${prefix}${index} from ${specifier};`;
  });
  const fields = ["__proto__: null"];
  for (const [index, id] of ids.entries()) {
    fields.push(`${JSON.stringify(id)}: ${prefix}${index}.default ?? ${prefix}${index}`);
  }
  lines.push(
    `const ${prefix}s = { ${fields.join(", ")} };`,
    "const require = (id) => {",
    // The table has no prototype, so `in` reads only its own keys and does
    // not depend on built-ins route code could replace.
    `  if (typeof id === "string" && id in ${prefix}s) return ${prefix}s[id];`,
    '  const error = new Error("Cannot find module " + JSON.stringify(String(id)));',
    '  error.code = "MODULE_NOT_FOUND";',
    "  throw error;",
    "};",
  );

  // A hashbang is only valid as the first line.
  const hashbangEnd = code.startsWith("#!") ? code.indexOf("\n") + 1 : 0;
  return code.slice(0, hashbangEnd) + lines.join("\n") + "\n" + code.slice(hashbangEnd);
}
