import { isCompiledBinary, serverLogger } from "#veryfront/utils";
import { redactedErrorMessage } from "./path-redaction.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { rewriteNpmImports } from "#veryfront/transforms/npm-import-rewrites.ts";
import { resolveContainedPackagePath } from "#veryfront/transforms/import-rewriter/package-resolution.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import {
  DEFAULT_ROUTE_HELPER_PREFIX,
  getNodeExternalPackagesToResolveForRoute,
  NODE_BUILTINS as ROUTE_NODE_BUILTINS,
  readProjectDependenciesForRoute,
  resolveEsmUserDependenciesForRoute,
  rewriteCompiledUserDependencyImportsForRoute,
  rewriteCompiledVeryfrontImportsForRoute,
  rewriteDenoNodeBuiltinsForRoute,
  rewriteDenoNpmDependencyImportsForRoute,
} from "#veryfront/transforms/import-rewriter/route-adapter.ts";
import type {
  EsmDependencyLocation as RouteEsmDependencyLocation,
} from "#veryfront/transforms/import-rewriter/route-adapter.ts";
import { resolveExportEntry } from "./loader-helpers.ts";
import { rethrowProjectBoundaryViolation } from "./project-source-snapshot.ts";

const logger = serverLogger.component("api");
type SourceReader = Pick<FileSystem, "readTextFile">;

/** Node.js built-in module names — shared across the CJS shim, esbuild externals, and Deno rewrites. */
export const NODE_BUILTINS = ROUTE_NODE_BUILTINS;

function splitImportSuffix(specifier: string): { path: string; suffix: string } {
  const queryIndex = specifier.indexOf("?");
  const hashIndex = specifier.indexOf("#");
  const suffixIndex = queryIndex === -1
    ? hashIndex
    : hashIndex === -1
    ? queryIndex
    : Math.min(queryIndex, hashIndex);
  if (suffixIndex === -1) return { path: specifier, suffix: "" };
  return {
    path: specifier.slice(0, suffixIndex),
    suffix: specifier.slice(suffixIndex),
  };
}

export async function readProjectDependencies(
  projectDir: string,
  fs: Pick<FileSystem, "readTextFile">,
): Promise<Map<string, string>> {
  return await readProjectDependenciesForRoute(projectDir, fs);
}

export { DEFAULT_ROUTE_HELPER_PREFIX };

/** Module-level names the prologue and compiled import rewrite declare. */
const ROUTE_HELPER_SUFFIXES = [
  "createRequire",
  "dirname",
  "resolve",
  "interopDefault",
  "namespace",
  "tmp_",
  "reexport_",
] as const;
const ROUTE_HELPER_NAME = /\b__vf_(createRequire|dirname|resolve|interopDefault|namespace)\b/g;

/**
 * Choose the prefix for the route prologue's module-level helpers.
 *
 * The prologue is prepended after esbuild has resolved collisions, so its
 * names must not appear in the bundled route at all. The first prefix none of
 * whose helper names occurs anywhere in the bundle is used, which keeps the
 * default whenever the route does not mention it.
 */
export function chooseRouteHelperPrefix(bundledCode: string): string {
  for (let index = 0;; index++) {
    const prefix = index === 0 ? DEFAULT_ROUTE_HELPER_PREFIX : `__vf${index}_`;
    if (!ROUTE_HELPER_SUFFIXES.some((suffix) => bundledCode.includes(prefix + suffix))) {
      return prefix;
    }
  }
}

/** Rename the prologue's module-level helpers from the default prefix. */
export function withRouteHelperPrefix(code: string, helperPrefix: string): string {
  if (helperPrefix === DEFAULT_ROUTE_HELPER_PREFIX) return code;
  return code.replace(ROUTE_HELPER_NAME, (_, suffix: string) => helperPrefix + suffix);
}

/**
 * Generates a CJS module loader shim for compiled Deno binaries.
 *
 * In compiled binaries, `createRequire()` can resolve module paths and load
 * built-in modules (fs, path, etc.), but cannot load CJS files from disk
 * (loadMaybeCjs fails with "path not found"). This shim works around that
 * limitation by using `Deno.readTextFileSync` to read CJS files and
 * `new Function` to evaluate them in a proper CJS wrapper with require,
 * exports, module, __filename, and __dirname bindings.
 *
 * The loader state lives in a private scope. Only `require`, the two helpers
 * the compiled import rewrite calls and the `node:` imports are module-level;
 * they carry `helperPrefix` (see chooseRouteHelperPrefix).
 */
export function generateCompiledBinaryRequireShim(
  projectDir: string,
  helperPrefix: string = DEFAULT_ROUTE_HELPER_PREFIX,
): string {
  // Helper names are renamed before the literals go in, so a project path that
  // happens to contain a helper name is embedded unchanged.
  const literals: Record<string, string> = {
    __VF_BUILTIN_LIST__: JSON.stringify(NODE_BUILTINS),
    __VF_PROJECT_DIR__: JSON.stringify(projectDir),
    __VF_PROJECT_ROOT__: JSON.stringify(pathHelper.resolve(projectDir)),
  };
  // One pass, so a literal that happens to contain a placeholder name is
  // never substituted again.
  const shim = withRouteHelperPrefix(COMPILED_BINARY_REQUIRE_SHIM_TEMPLATE, helperPrefix).replace(
    /__VF_(?:BUILTIN_LIST|PROJECT_DIR|PROJECT_ROOT)__/g,
    (placeholder) => literals[placeholder]!,
  );
  return shim;
}

const COMPILED_BINARY_REQUIRE_SHIM_TEMPLATE = `
import { createRequire as __vf_createRequire } from "node:module";
import { dirname as __vf_dirname, resolve as __vf_resolve } from "node:path";
var __vf_namespace;
var require = (function () {
// Route code shares this module scope, so a top-level route binding named like
// an intrinsic (\`const Set = ...\`) would shadow it here, or still be
// uninitialized when this runs. These locals come from the global object,
// which is reached through syntax alone.
var __vf_global = (function () {}).constructor("return this")();
var Deno = __vf_global.Deno, Error = __vf_global.Error, Function = __vf_global.Function;
var Map = __vf_global.Map, Set = __vf_global.Set, TypeError = __vf_global.TypeError;
var globalThis = __vf_global;
// The static methods the loader calls are captured now, before route code
// runs, so a later \`Object.freeze = ...\` cannot change how it behaves.
var __vf_Object = __vf_global.Object;
var Object = {
  create: __vf_Object.create,
  defineProperty: __vf_Object.defineProperty,
  freeze: __vf_Object.freeze,
  getOwnPropertyDescriptor: __vf_Object.getOwnPropertyDescriptor,
  keys: __vf_Object.keys,
  prototype: { hasOwnProperty: __vf_Object.prototype.hasOwnProperty },
};
var Array = { isArray: __vf_global.Array.isArray };
var JSON = { parse: __vf_global.JSON.parse, stringify: __vf_global.JSON.stringify };
var Symbol = { toStringTag: __vf_global.Symbol.toStringTag };
var __vf_builtinRequire = __vf_createRequire(__VF_PROJECT_DIR__ + "/package.json");
var __vf_builtinSet = new Set(__VF_BUILTIN_LIST__);
// Every built-in this runtime provides, not only the shared list. Node's
// prefix-only built-ins (node:test, node:sqlite, node:sea) have no bare form,
// so a package of that name still resolves from node_modules, even where the
// runtime lists the bare name.
var __vf_prefixOnlyBuiltins = new Set(["sea", "sqlite", "test", "test/reporters"]);
try {
  var __vf_runtimeBuiltins = __vf_builtinRequire("node:module").builtinModules;
  for (var __vf_b = 0; __vf_b < __vf_runtimeBuiltins.length; __vf_b++) {
    var __vf_name = __vf_runtimeBuiltins[__vf_b];
    if (__vf_name.startsWith("node:") || __vf_prefixOnlyBuiltins.has(__vf_name)) continue;
    __vf_builtinSet.add(__vf_name);
  }
} catch (_) { /* expected: fall back to the shared list */ }
// Absolute ids include Windows drive-letter and UNC paths.
var __vf_isAbsolute = __vf_builtinRequire("node:path").isAbsolute;
function __vf_isPathId(id) {
  return id.startsWith(".") || __vf_isAbsolute(id);
}
var __vf_projectRoot = __VF_PROJECT_ROOT__;
// VULN-FS-5: Canonicalize the project root so containment checks using
// Deno.realPathSync(resolved) compare canonical-vs-canonical. Without this,
// when the project itself is opened via a symlink, the realpath'd resolved
// module path has a different prefix than the non-canonical projectRoot and
// legitimate dependencies would be rejected.
try { __vf_projectRoot = Deno.realPathSync(__vf_projectRoot); } catch (_) { /* expected: projectRoot may not exist at shim init in some environments */ }
var __vf_cache = Object.create(null);
var __vf_parentRequires = Object.create(null);
// Resolve symlinks so containment compares canonical paths. A module that does
// not exist yet cannot be canonicalized, so fall back to its parent directory,
// which is what carries a symlinked project root; only if that fails too is the
// plain resolved path used.
function __vf_canonicalize(candidate) {
  try {
    return Deno.realPathSync(candidate);
  } catch (_) { /* expected: candidate may not exist */ }
  try {
    var parent = __vf_dirname(candidate);
    return Deno.realPathSync(parent) + candidate.slice(parent.length);
  } catch (_) { /* expected: parent may not exist either */ }
  return __vf_resolve(candidate);
}
// The error names the id the code asked for, never the resolved host path.
function __vf_assertContained(resolved, id) {
  var norm = __vf_resolve(resolved).replace(/\\\\/g, "/");
  var root = __vf_projectRoot.replace(/\\\\/g, "/");
  // A project at a filesystem root ("/", "C:/") already ends in a separator.
  var prefix = root.endsWith("/") ? root : root + "/";
  if (!norm.startsWith(prefix) && norm !== root) {
    throw new Error("CJS loader blocked path outside project: " + JSON.stringify(id));
  }
}
// Bare ids resolve from the requiring module's directory, as Node does, so a
// package's own non-hoisted node_modules wins over the project root's copy.
function __vf_parentRequire(parentDir) {
  var cached = __vf_parentRequires[parentDir];
  if (cached) return cached;
  cached = __vf_createRequire(__vf_resolve(parentDir, "__vf_parent.js"));
  __vf_parentRequires[parentDir] = cached;
  return cached;
}
function __vf_packageName(id) {
  var parts = id.split("/");
  return id.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}
function __vf_packageInstalled(name, parentDir) {
  for (var dir = __vf_resolve(parentDir); ; dir = __vf_dirname(dir)) {
    try { Deno.statSync(__vf_resolve(dir, "node_modules", name)); return true; } catch (_) { /* expected: not installed at this level */ }
    if (__vf_dirname(dir) === dir) return false;
  }
}
// Node's package "exports" resolution for require(), used where the runtime's
// resolver cannot be: a target is undefined when nothing matched, null when the
// package blocks the subpath. Conditions are tried in the object's key order.
var __vf_requireConditions = { require: true, node: true, "node-addons": true, default: true };
function __vf_exportsTarget(target, star) {
  if (typeof target === "string") {
    if (!target.startsWith("./")) return null;
    var value = star === void 0 ? target : target.split("*").join(star);
    var segments = value.slice(2).split("/");
    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i];
      if (segment === "" || segment === "." || segment === ".." || segment === "node_modules" || segment.indexOf("\\\\") !== -1) return null;
    }
    return value;
  }
  if (Array.isArray(target)) {
    for (var j = 0; j < target.length; j++) {
      var candidate = __vf_exportsTarget(target[j], star);
      if (typeof candidate === "string") return candidate;
    }
    return null;
  }
  if (target && typeof target === "object") {
    var conditions = Object.keys(target);
    for (var k = 0; k < conditions.length; k++) {
      if (!__vf_requireConditions[conditions[k]]) continue;
      var resolved = __vf_exportsTarget(target[conditions[k]], star);
      if (resolved !== void 0) return resolved;
    }
    return void 0;
  }
  return null;
}
function __vf_exportsSubpath(exportsField, subpath) {
  var keys = exportsField && typeof exportsField === "object" && !Array.isArray(exportsField) ? Object.keys(exportsField) : [];
  var dotKeys = keys.filter(function (key) { return key.startsWith("."); }).length;
  if (dotKeys !== 0 && dotKeys !== keys.length) return null;
  var map = dotKeys === 0 ? { ".": exportsField } : exportsField;
  if (Object.prototype.hasOwnProperty.call(map, subpath) && subpath.indexOf("*") === -1) {
    return __vf_exportsTarget(map[subpath], void 0);
  }
  var bestKey = null;
  var bestPrefix = -1;
  var bestStar;
  var patterns = Object.keys(map);
  for (var i = 0; i < patterns.length; i++) {
    var key = patterns[i];
    var starAt = key.indexOf("*");
    if (starAt === -1 || key.indexOf("*", starAt + 1) !== -1) continue;
    var prefix = key.slice(0, starAt);
    var suffix = key.slice(starAt + 1);
    if (subpath.length < key.length || !subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    if (prefix.length > bestPrefix || (prefix.length === bestPrefix && key.length > bestKey.length)) {
      bestKey = key;
      bestPrefix = prefix.length;
      bestStar = subpath.slice(prefix.length, subpath.length - suffix.length);
    }
  }
  return bestKey === null ? void 0 : __vf_exportsTarget(map[bestKey], bestStar);
}
// Resolves id inside an installed package directory: through its "exports"
// map when it has one, as Node does, otherwise by plain file lookup. Errors
// name the id, never the host path.
function __vf_resolveInPackage(id, dir, packageDir) {
  var name = __vf_packageName(id);
  var manifest = __vf_resolve(packageDir, "package.json");
  var exportsField;
  if (__vf_isFile(manifest)) {
    try {
      exportsField = JSON.parse(__vf_readText(manifest, name)).exports;
    } catch (_) {
      throw new Error("invalid package.json for " + JSON.stringify(name));
    }
  }
  if (exportsField === void 0 || exportsField === null) {
    // A relative id keeps host paths out of any error it raises.
    return __vf_resolveLocal("./node_modules/" + id, dir);
  }
  var subpath = "." + id.slice(name.length);
  var target = __vf_exportsSubpath(exportsField, subpath);
  if (typeof target !== "string") {
    var blocked = new Error("npm package " + JSON.stringify(name) + " does not export " + JSON.stringify(subpath));
    blocked.code = "ERR_PACKAGE_PATH_NOT_EXPORTED";
    throw blocked;
  }
  var exported = __vf_resolve(packageDir, target);
  __vf_assertContained(__vf_canonicalize(exported), id);
  if (!__vf_isFile(exported)) {
    var missing = new Error("Cannot find module " + JSON.stringify(id));
    missing.code = "MODULE_NOT_FOUND";
    throw missing;
  }
  return exported;
}
// A package named like a prefix-only built-in (test, sqlite, sea) is looked up
// in node_modules directly: the runtime's resolver may claim the bare name.
function __vf_resolvePrefixOnlyName(id, parentDir) {
  for (var dir = __vf_resolve(parentDir); ; dir = __vf_dirname(dir)) {
    var packageDir = __vf_resolve(dir, "node_modules", __vf_packageName(id));
    var exists = false;
    try { Deno.statSync(packageDir); exists = true; } catch (_) { /* expected: not installed at this level */ }
    if (exists) return __vf_resolveInPackage(id, dir, packageDir);
    if (__vf_dirname(dir) === dir) break;
  }
  var missing = new Error("npm package " + JSON.stringify(__vf_packageName(id)) + " is not installed in this runtime's node_modules");
  missing.code = "MODULE_NOT_FOUND";
  throw missing;
}
function __vf_resolveBare(id, parentDir) {
  if (__vf_prefixOnlyBuiltins.has(__vf_packageName(id))) return __vf_resolvePrefixOnlyName(id, parentDir);
  try {
    return __vf_parentRequire(parentDir).resolve(id);
  } catch (error) {
    // The resolver's message carries host paths in its require stack. Name
    // only what the route asked for, and say "not installed" only when no
    // node_modules on the lookup path has the package at all.
    var name = __vf_packageName(id);
    // Other resolver errors (an invalid package.json, a blocked subpath) keep
    // their code but not their message, which names host paths.
    if (!error || error.code !== "MODULE_NOT_FOUND") {
      var failed = new Error("npm package " + JSON.stringify(name) + " could not be resolved" + (error && error.code ? " (" + error.code + ")" : ""));
      if (error && error.code) failed.code = error.code;
      throw failed;
    }
    // Keep the code: packages probe optional dependencies with
    // \`error.code === "MODULE_NOT_FOUND"\`.
    var sanitized = new Error(__vf_packageInstalled(name, parentDir)
      ? "npm package " + JSON.stringify(name) + " is installed but " + JSON.stringify(id) + " could not be resolved"
      : "npm package " + JSON.stringify(name) + " is not installed in this runtime's node_modules");
    sanitized.code = "MODULE_NOT_FOUND";
    throw sanitized;
  }
}
// Relative and absolute ids resolve against the requiring module's directory,
// probing the extensions Node probes. A missing module is reported by the id
// the code asked for, not the host path it was looked up at.
function __vf_isFile(candidate) {
  try { return Deno.statSync(candidate).isFile; } catch (_) { return false; }
}
function __vf_probeFile(path) {
  // ".node" is probed so an extensionless native addon reaches the
  // unsupported-addon error instead of a misleading MODULE_NOT_FOUND.
  // Node's order for an extensionless request; ".cjs" is never added.
  var candidates = [path, path + ".js", path + ".json", path + ".node"];
  for (var i = 0; i < candidates.length; i++) {
    if (__vf_isFile(candidates[i])) return candidates[i];
  }
  return null;
}
function __vf_probeIndex(dir) {
  return __vf_probeFile(__vf_resolve(dir, "index"));
}
// A directory resolves through its package.json "main", then its index file.
function __vf_probeDirectory(dir, id) {
  var manifest = __vf_resolve(dir, "package.json");
  if (__vf_isFile(manifest)) {
    // As in Node, an unreadable or malformed manifest is an error, not a
    // reason to fall back to index.
    var main;
    try {
      main = JSON.parse(__vf_readText(manifest, id)).main;
    } catch (_) {
      throw new Error("invalid package.json for " + JSON.stringify(id));
    }
    if (typeof main === "string" && main) {
      var entry = __vf_resolve(dir, main);
      __vf_assertContained(__vf_canonicalize(entry), id);
      var found = __vf_probeFile(entry) || __vf_probeIndex(entry);
      if (found) return found;
    }
  }
  return __vf_probeIndex(dir);
}
function __vf_resolveLocal(id, parentDir) {
  var base = __vf_resolve(parentDir, id);
  // Refuse paths outside the project before probing them, so a missing-module
  // error never tells route code whether a host file exists.
  __vf_assertContained(__vf_canonicalize(base), id);
  var found = __vf_probeFile(base) || __vf_probeDirectory(base, id);
  if (found) {
    __vf_assertContained(__vf_canonicalize(found), id);
    return found;
  }
  var missing = new Error("Cannot find module " + JSON.stringify(id));
  missing.code = "MODULE_NOT_FOUND";
  throw missing;
}
function __vf_isBuiltin(id) {
  if (id.startsWith("node:")) return true;
  // Only the runtime's own built-in ids: "fs/promises" is a built-in, while
  // "fs/plugin" resolves from an installed package named fs, as in Node.
  return __vf_builtinSet.has(id);
}
// Node's module.paths: each ancestor's node_modules, stopping at the project
// root so host directories above it are never listed. The directory is
// canonicalized first, so the walk meets the canonical root even when the
// project was opened through a symlink.
function __vf_nodeModulePaths(dir) {
  var paths = [];
  var start = __vf_canonicalize(dir);
  try { __vf_assertContained(start, dir); } catch (_) { return paths; }
  for (var current = start; ; current = __vf_dirname(current)) {
    if (!/(^|[\\\\/])node_modules$/.test(current)) paths.push(__vf_resolve(current, "node_modules"));
    if (current === __vf_projectRoot || __vf_dirname(current) === current) break;
  }
  return paths;
}
// require.resolve(id) and require.resolve(id, { paths }): with paths, id
// resolves from each listed directory in turn. Either way a module result must
// stay inside the project, as loading it would, so no host path leaks out.
function __vf_resolveContained(id, parentDir) {
  var found = __vf_resolveId(id, parentDir);
  if (!__vf_isBuiltin(id) && !__vf_isBuiltin(found)) __vf_assertContained(__vf_canonicalize(found), id);
  return found;
}
function __vf_resolveWithOptions(id, parentDir, options) {
  // Built-ins resolve to themselves, whatever search paths are given.
  if (__vf_isBuiltin(id)) return id;
  if (!options || options.paths === void 0) return __vf_resolveContained(id, parentDir);
  if (!Array.isArray(options.paths)) throw new TypeError("require.resolve options.paths must be an array");
  for (var i = 0; i < options.paths.length; i++) {
    try {
      return __vf_resolveContained(id, __vf_resolve(parentDir, options.paths[i]));
    } catch (error) {
      if (!error || error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  var missing = new Error("Cannot find module " + JSON.stringify(id));
  missing.code = "MODULE_NOT_FOUND";
  throw missing;
}
// A CommonJS module evaluated through Function would resolve its own
// import("./x.mjs") against this handler, not its file. Literal relative and
// absolute dynamic imports in code (not in strings, comments, templates or
// regex literals) are routed to a module-relative loader instead.
var __vf_regexAfterWord = { "return": 1, "typeof": 1, "instanceof": 1, "in": 1, "of": 1, "new": 1, "delete": 1, "void": 1, "throw": 1, "case": 1, "do": 1, "else": 1, "yield": 1, "await": 1 };
// Only "import(" and the specifier are replaced, so an options argument and
// the closing parenthesis stay as written and reach the helper.
function __vf_skipQuoted(code, i, quote) {
  for (i++; i < code.length && code[i] !== quote; i++) {
    if (code[i] === "\\\\") i++;
  }
  return i + 1;
}
function __vf_skipRegex(code, i) {
  var inClass = false;
  for (i++; i < code.length; i++) {
    var c = code[i];
    if (c === "\\\\") i++;
    else if (c === "\\n") return i;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i + 1;
  }
  return i;
}
function __vf_skipTrivia(code, i) {
  for (;;) {
    var c = code[i];
    if (c === " " || c === "\\t" || c === "\\n" || c === "\\r") { i++; continue; }
    if (c === "/" && code[i + 1] === "/") {
      var lineEnd = code.indexOf("\\n", i);
      i = lineEnd === -1 ? code.length : lineEnd;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      var blockEnd = code.indexOf("*/", i + 2);
      i = blockEnd === -1 ? code.length : blockEnd + 2;
      continue;
    }
    return i;
  }
}
var __vf_simpleEscapes = { b: "\\b", f: "\\f", n: "\\n", r: "\\r", t: "\\t", v: "\\v", "0": "\\0" };
// The value of a string literal's body, with its escapes decoded.
function __vf_decodeStringBody(body) {
  return body.replace(/\\\\(?:u\\{([0-9a-fA-F]+)\\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(\\r\\n|[\\s\\S]))/g, function (_match, codePoint, unit, byte, other) {
    var hex = codePoint || unit || byte;
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (other === "\\n" || other === "\\r" || other === "\\r\\n" || other === " " || other === " ") return "";
    return __vf_simpleEscapes[other] !== void 0 ? __vf_simpleEscapes[other] : other;
  });
}
// At an "import" token: the end of "import ( <string>" when the string is a
// relative or absolute path, with comments allowed between the tokens, or null.
function __vf_matchRelativeImport(code, afterWord) {
  var open = __vf_skipTrivia(code, afterWord);
  if (code[open] !== "(") return null;
  var quoteAt = __vf_skipTrivia(code, open + 1);
  var quote = code[quoteAt];
  if (quote !== "'" && quote !== '"') return null;
  var end = __vf_skipQuoted(code, quoteAt, quote);
  var spec = __vf_decodeStringBody(code.slice(quoteAt + 1, end - 1));
  if (!/^(?:\\.{1,2}\\/|\\/)/.test(spec)) return null;
  return { end: end, spec: spec };
}
function __vf_rewriteCjsDynamicImports(code, helperName) {
  if (code.indexOf("import") === -1) return code;
  var out = "";
  var copied = 0;
  // "" or a punctuator: the last significant token; "word" and "value" mean an
  // identifier or literal ended, after which "/" divides.
  var previous = "";
  var stack = [];
  var i = 0;
  while (i < code.length) {
    var c = code[i];
    if (c === " " || c === "\\t" || c === "\\n" || c === "\\r") { i++; continue; }
    if (c === "/" && code[i + 1] === "/") {
      var lineEnd = code.indexOf("\\n", i);
      i = lineEnd === -1 ? code.length : lineEnd;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      var blockEnd = code.indexOf("*/", i + 2);
      i = blockEnd === -1 ? code.length : blockEnd + 2;
      continue;
    }
    if (c === "'" || c === '"') { i = __vf_skipQuoted(code, i, c); previous = "value"; continue; }
    if (c === "\`" || (c === "}" && stack[stack.length - 1] === "\${")) {
      // A template, or its continuation after a substitution.
      if (c === "}") stack.pop();
      var substitution = false;
      for (i++; i < code.length; i++) {
        if (code[i] === "\\\\") { i++; continue; }
        if (code[i] === "\`") { i++; break; }
        if (code[i] === "$" && code[i + 1] === "{") { stack.push("\${"); i += 2; substitution = true; break; }
      }
      previous = substitution ? "(" : "value";
      continue;
    }
    if (c === "/") {
      if (previous === "word" || previous === "value" || previous === ")" || previous === "]") {
        i++;
        previous = "/";
      } else {
        i = __vf_skipRegex(code, i);
        previous = "value";
      }
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) > 127) {
      var start = i;
      while (i < code.length && (/[A-Za-z0-9_$]/.test(code[i]) || code.charCodeAt(i) > 127)) i++;
      var word = code.slice(start, i);
      if (word === "import" && previous !== ".") {
        var call = __vf_matchRelativeImport(code, i);
        if (call) {
          out += code.slice(copied, start) + helperName + "(" + JSON.stringify(call.spec);
          copied = i = call.end;
          previous = "value";
          continue;
        }
      }
      previous = __vf_regexAfterWord[word] === 1 ? "(" : "word";
      continue;
    }
    if (c === "{") stack.push("{");
    else if (c === "}") stack.pop();
    previous = c;
    i++;
  }
  return copied === 0 ? code : out + code.slice(copied);
}
function __vf_importFrom(spec, parentDir, options) {
  return (async function () {
    // A query or hash belongs to the module URL, not to the file path.
    var suffixAt = spec.search(/[?#]/);
    var path = suffixAt === -1 ? spec : spec.slice(0, suffixAt);
    var target = __vf_resolve(parentDir, path);
    __vf_assertContained(__vf_canonicalize(target), spec);
    var toUrl = __vf_builtinRequire("node:url").pathToFileURL;
    var url = toUrl(target).href + (suffixAt === -1 ? "" : spec.slice(suffixAt));
    try {
      return options === void 0 ? await import(url) : await import(url, options);
    } catch (error) {
      // A load failure for this file names its host path; report the
      // specifier the package wrote instead.
      var message = error && typeof error.message === "string" ? error.message : "";
      if (message.indexOf(__vf_projectRoot) === -1 && message.indexOf(toUrl(__vf_projectRoot).href) === -1) throw error;
      var failed = new Error("cannot import " + JSON.stringify(spec) + " from a CommonJS module" + (error && error.code ? " (" + error.code + ")" : ""));
      if (error && error.code) failed.code = error.code;
      throw failed;
    }
  })();
}
// Reads a module or manifest as Node does: a UTF-8 byte-order mark is dropped,
// and a read failure names the requested id, never the host path.
function __vf_readText(path, id) {
  var text;
  try {
    text = Deno.readTextFileSync(path);
  } catch (error) {
    var failed = new Error("cannot read module " + JSON.stringify(id) + (error && error.code ? " (" + error.code + ")" : ""));
    if (error && error.code) failed.code = error.code;
    throw failed;
  }
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}
// As in Node, every required module records the module that first required it
// as module.parent, and each requiring module lists it once in module.children.
function __vf_linkChild(parentMod, mod) {
  if (parentMod && parentMod.children.indexOf(mod) === -1) parentMod.children.push(mod);
}
function __vf_loadCjs(id, parentDir, parentMod) {
  if (__vf_isBuiltin(id)) return __vf_builtinRequire(id);
  var resolved;
  if (__vf_isPathId(id)) {
    resolved = __vf_resolveLocal(id, parentDir);
  } else {
    resolved = __vf_resolveBare(id, parentDir);
  }
  if (resolved.endsWith(".node")) {
    throw new Error("native addon " + JSON.stringify(id) + " cannot be loaded: native addons are not supported in this runtime");
  }
  if (resolved.endsWith(".mjs")) {
    throw new Error("ES module file " + JSON.stringify(id) + " cannot be loaded with require: import the package by a CommonJS entry");
  }
  // VULN-FS-5: Canonicalize before asserting containment, so the candidate and
  // the already-canonical project root are compared like with like, then assert
  // once. Checking the non-canonical path first rejected dependencies genuinely
  // inside a project whose root is reached through a symlink, which is the
  // ordinary case for package managers, CI checkouts and macOS /tmp.
  // Canonicalizing first also keeps the guard against symlinked node_modules
  // entries pointing outside the root: the escape is only visible once resolved.
  resolved = __vf_canonicalize(resolved);
  __vf_assertContained(resolved, id);
  // The cache holds module records, so a circular require sees a
  // reassigned module.exports while the first module is still evaluating.
  if (resolved in __vf_cache) {
    __vf_linkChild(parentMod, __vf_cache[resolved]);
    return __vf_cache[resolved].exports;
  }
  var code = __vf_readText(resolved, id);
  if (resolved.endsWith(".json")) {
    var json = JSON.parse(code);
    var jsonMod = { exports: json, id: resolved, filename: resolved, loaded: true, children: [], parent: parentMod };
    __vf_cache[resolved] = jsonMod;
    __vf_linkChild(parentMod, jsonMod);
    return json;
  }
  // Node strips a leading hashbang from CommonJS sources; a Function body
  // cannot contain one. Commenting it out keeps line numbers intact.
  if (code.startsWith("#!")) code = "//" + code.slice(2);
  var dir = __vf_dirname(resolved);
  // The helper's name is one the package's source never mentions, so no
  // binding of the package can shadow it at a rewritten import.
  var importHelper = "__vf_cjsImport";
  while (code.indexOf(importHelper) !== -1) importHelper += "_";
  code = __vf_rewriteCjsDynamicImports(code, importHelper);
  var cjsImport = function (spec, options) { return __vf_importFrom(spec, dir, options); };
  var mod;
  var childReq = function(childId) { return __vf_loadCjs(childId, dir, mod); };
  childReq.resolve = function(childId, options) { return __vf_resolveWithOptions(childId, dir, options); };
  childReq.ensure = function(mods, cb) { cb(); };
  // The CommonJS module API packages use: module.require, id, filename, path.
  mod = { exports: {}, id: resolved, filename: resolved, path: dir, loaded: false, children: [], paths: __vf_nodeModulePaths(dir), parent: parentMod, require: childReq };
  __vf_cache[resolved] = mod;
  __vf_linkChild(parentMod, mod);
  // As in Node, top-level \`this\` is module.exports, and a module whose
  // evaluation throws is dropped from the cache so a retry fails again.
  try {
    // The wrapper's own parameters are Node's five. global, globalThis,
    // Worker and the dynamic-import helper come from an enclosing function,
    // so a package's own top-level \`const Worker\` shadows them instead of
    // colliding with a parameter.
    var outer = new Function("global", "globalThis", "Worker", importHelper, "return function (exports, require, module, __filename, __dirname) {\\n" + code + "\\n};");
    var fn = outer(globalThis, globalThis, void 0, cjsImport);
    fn.call(mod.exports, mod.exports, childReq, mod, resolved, dir);
  } catch (error) {
    delete __vf_cache[resolved];
    if (parentMod) {
      var childIdx = parentMod.children.indexOf(mod);
      if (childIdx !== -1) parentMod.children.splice(childIdx, 1);
    }
    throw error;
  }
  mod.loaded = true;
  return mod.exports;
}
function __vf_resolveId(id, parentDir) {
  if (__vf_isPathId(id)) return __vf_resolveLocal(id, parentDir);
  return __vf_resolveBare(id, parentDir);
}
// The route is the parent of the modules it requires, as the module a Node
// createRequire() call is anchored to would be.
var routeModule = { exports: {}, id: __VF_PROJECT_DIR__, filename: __VF_PROJECT_DIR__, path: __VF_PROJECT_DIR__, loaded: true, children: [], paths: __vf_nodeModulePaths(__vf_projectRoot), parent: null };
var routeRequire = function(id) { return __vf_loadCjs(id, __VF_PROJECT_DIR__, routeModule); };
routeRequire.resolve = function(id, options) { return __vf_resolveWithOptions(id, __VF_PROJECT_DIR__, options); };
routeRequire.ensure = function(mods, cb) { cb(); };
routeModule.require = routeRequire;
// One namespace per resolved module, as with ES module namespaces: repeated
// imports of a module share it, and distinct modules never do. As with native
// CommonJS interop, \`default\` is the whole module.exports, also for modules
// marked __esModule.
var namespaces = new Map();
__vf_namespace = function (id) {
  var key = __vf_isBuiltin(id)
    ? "builtin:" + id.replace(/^node:/, "")
    : __vf_canonicalize(__vf_resolveId(id, __VF_PROJECT_DIR__));
  if (namespaces.has(key)) return namespaces.get(key);
  var m = routeRequire(id);
  var ns = Object.create(null);
  if (m !== null && (typeof m === "object" || typeof m === "function")) {
    // Own properties only: native interop never exposes inherited ones, and
    // reading them could run an inherited getter during import.
    // Getters stay lazy: an export getter runs when the name is read, not
    // while the namespace is built.
    var names = Object.keys(m);
    for (var i = 0; i < names.length; i++) {
      if (names[i] === "default") continue;
      var descriptor = Object.getOwnPropertyDescriptor(m, names[i]);
      if (descriptor && "value" in descriptor) {
        Object.defineProperty(ns, names[i], { value: descriptor.value, enumerable: true, writable: true });
      } else {
        Object.defineProperty(ns, names[i], { enumerable: true, get: (function (key) { return function () { return m[key]; }; })(names[i]) });
      }
    }
  }
  ns.default = m;
  // Module namespaces are sealed: strict-mode writes, additions and deletes
  // throw a TypeError, as they do on a native namespace.
  Object.defineProperty(ns, Symbol.toStringTag, { value: "Module" });
  Object.freeze(ns);
  namespaces.set(key, ns);
  return ns;
};
return routeRequire;
})();
function __vf_interopDefault(m) { return m && m.__esModule && m.default !== void 0 ? m.default : m; }
`.trim();

export function getNodeExternalPackagesToResolve(userDeps: Map<string, string>): string[] {
  return getNodeExternalPackagesToResolveForRoute(userDeps);
}

export async function resolveNodePackageToFileUrl(
  projectDir: string,
  packageName: string,
  fs: SourceReader,
  pathToFileURL: typeof import("node:url").pathToFileURL,
): Promise<string | null> {
  const packagePath = pathHelper.join(projectDir, "node_modules", packageName);
  const packageJsonPath = pathHelper.join(packagePath, "package.json");

  try {
    const pkgJson = JSON.parse(await fs.readTextFile(packageJsonPath));
    let entryPoint: string | undefined;

    if (pkgJson.exports) {
      entryPoint = resolveExportEntry(pkgJson.exports["."]);
    }

    entryPoint ||= pkgJson.module || pkgJson.main || "index.js";
    if (!entryPoint) return null;

    return pathToFileURL(pathHelper.join(packagePath, entryPoint)).href;
  } catch (error) {
    rethrowProjectBoundaryViolation(error);
    /* expected: package.json may not exist or be invalid */
    return null;
  }
}

export type EsmDependencyLocation = RouteEsmDependencyLocation;

/**
 * Identify the subset of user dependencies that are ESM-only and resolve each
 * to file:// URLs so the compiled-binary loader can import them as real ES
 * modules instead of transpiling them to CommonJS. CJS dependencies are omitted
 * and continue to load through the `createRequire`-based shim.
 */
export async function resolveEsmUserDependencies(
  projectDir: string,
  fs: SourceReader,
  userDeps: Map<string, string>,
): Promise<Map<string, EsmDependencyLocation>> {
  return await resolveEsmUserDependenciesForRoute(projectDir, fs, userDeps);
}

export async function loadVeryfrontExportsMap(
  projectDir: string,
  fs: SourceReader,
): Promise<Record<string, { import?: string }>> {
  const vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
  const vfPackageJsonPath = pathHelper.join(vfPackagePath, "package.json");

  try {
    const pkgJson = JSON.parse(await fs.readTextFile(vfPackageJsonPath));
    return pkgJson.exports || {};
  } catch (error) {
    rethrowProjectBoundaryViolation(error);
    logger.debug("Could not read veryfront package.json");
    return {};
  }
}

export async function rewriteNodeExternalImports(
  code: string,
  projectDir: string,
  fs: SourceReader,
  userDeps: Map<string, string>,
  options: {
    loadRunningPackage?: () => Promise<RunningVeryfrontPackage | null>;
  } = {},
): Promise<string> {
  const { pathToFileURL } = await import("node:url");
  const replacements = new Map<string, string>();

  // These logs name specifiers, not their targets: a target is an absolute
  // file URL into the host's node_modules.
  logger.debug("Rewriting external imports for Node.js");

  const importedSpecifiers = new Set(
    (await parseImports(code))
      .map((imp) => imp.n)
      .filter((specifier): specifier is string => typeof specifier === "string"),
  );
  const packages = getNodeExternalPackagesToResolve(userDeps);

  for (const specifier of importedSpecifiers) {
    const pkg = packages.find((name) => specifier === name || specifier.startsWith(`${name}/`));
    if (!pkg) continue;

    const { path: specifierPath, suffix } = splitImportSuffix(specifier);
    const subpath = specifierPath.slice(pkg.length);
    if (subpath) {
      // The subpath comes from the handler source; reject any that escape the
      // package directory (e.g. "pkg/../../secret") by leaving the import
      // untouched so it fails to resolve rather than reading outside
      // node_modules.
      const packageDir = pathHelper.resolve(projectDir, "node_modules", pkg);
      const target = resolveContainedPackagePath(packageDir, `.${subpath}`);
      if (!target) {
        logger.warn(`Skipping subpath import that escapes package directory: ${specifier}`);
        continue;
      }
      const resolvedSubpath = `${pathToFileURL(target).href}${suffix}`;
      logger.debug(`Resolved ${specifier} to a project package file`);
      replacements.set(specifier, resolvedSubpath);
      continue;
    }

    const resolvedUrl = await resolveNodePackageToFileUrl(projectDir, pkg, fs, pathToFileURL);
    if (!resolvedUrl) continue;
    logger.debug(`Resolved ${pkg} to a project package`);
    replacements.set(specifier, resolvedUrl);
  }

  const veryfrontSpecifiers = [...importedSpecifiers].filter(
    (specifier) => specifier === "veryfront" || specifier.startsWith("veryfront/"),
  );

  if (veryfrontSpecifiers.length > 0) {
    // A route's `veryfront/*` import must land on the SAME module instance the
    // server is running, or the route gets a second, empty copy of every
    // registry (`toolRegistry.get()` returns undefined for tools the server has
    // loaded). The project's node_modules copy is only the same instance by
    // coincidence — a global install, an npx cache, or a hoisted monorepo store
    // all break it. The Deno path already resolves against the running package.
    const runningPackage = await (options.loadRunningPackage ?? loadRunningVeryfrontPackage)();
    let projectExports: Record<string, { import?: string }> | undefined;

    // Fallback for a subpath the running copy does not export — an older global
    // CLI against a newer project dependency. A split instance still beats a
    // bare specifier the temp handler module cannot resolve at all.
    const resolveFromProjectCopy = async (specifier: string, subpath: string): Promise<void> => {
      projectExports ??= await loadVeryfrontExportsMap(projectDir, fs);
      const exportEntry = projectExports[subpath];
      if (!exportEntry?.import) {
        if (subpath !== ".") logger.warn(`No export found for ${subpath}`);
        return;
      }

      const vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
      const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
      logger.debug(`Resolved ${specifier} from the project's veryfront copy`);
      replacements.set(specifier, pathToFileURL(resolvedPath).href);
    };

    for (const specifier of veryfrontSpecifiers) {
      const subpath = specifier === "veryfront" ? "." : "./" + specifier.slice("veryfront/".length);

      if (runningPackage) {
        try {
          const resolved = resolveVeryfrontPackageExport(specifier, runningPackage);
          logger.debug(`Resolved ${specifier} from the running package`);
          replacements.set(specifier, resolved);
          continue;
        } catch (error) {
          logger.warn(
            `Running package does not export ${specifier} (${redactedErrorMessage(error)}); ` +
              `falling back to the project copy`,
          );
        }
      }

      await resolveFromProjectCopy(specifier, subpath);
    }
  }

  if (replacements.size === 0) return code;

  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier));
}

export function rewriteCompiledBinaryVeryfrontImports(code: string): string {
  return rewriteCompiledVeryfrontImportsForRoute(code);
}

export async function rewriteCompiledBinaryUserDependencyImports(
  code: string,
  userDeps: Map<string, string>,
  esmDeps: Map<string, EsmDependencyLocation> = new Map(),
  helperPrefix: string = DEFAULT_ROUTE_HELPER_PREFIX,
): Promise<string> {
  return await rewriteCompiledUserDependencyImportsForRoute(code, userDeps, esmDeps, helperPrefix);
}

export async function rewriteDenoNpmDependencyImports(
  code: string,
  projectDir: string,
  fs: SourceReader,
  userDeps: Map<string, string>,
): Promise<string> {
  return await rewriteDenoNpmDependencyImportsForRoute(code, projectDir, fs, userDeps);
}

export function rewriteDenoNodeBuiltinImports(code: string): string {
  return rewriteDenoNodeBuiltinsForRoute(code);
}

export interface RunningVeryfrontPackage {
  packageUrl: URL;
  exports: Record<string, unknown>;
}

let runningVeryfrontPackage: Promise<RunningVeryfrontPackage | null> | null = null;

/**
 * Read the package.json of the veryfront copy that is currently executing.
 * Deno reads it directly; Node needs `node:fs`, and Node is exactly where this
 * matters — the npm CLI falls back to the packaged ESM build.
 */
async function readRunningPackageJson(packageUrl: URL): Promise<string> {
  if (isDeno) return await Deno.readTextFile(packageUrl);
  const [{ readFile }, { fileURLToPath }] = await Promise.all([
    import("node:fs/promises"),
    import("node:url"),
  ]);
  return await readFile(fileURLToPath(packageUrl), "utf8");
}

function loadRunningVeryfrontPackage(): Promise<RunningVeryfrontPackage | null> {
  runningVeryfrontPackage ??= (async () => {
    const packageUrl = new URL("../../../../../package.json", import.meta.url);
    try {
      const raw = await readRunningPackageJson(packageUrl);
      const pkg = JSON.parse(raw) as { name?: unknown; exports?: unknown };
      if (pkg.name !== "veryfront" || !pkg.exports || typeof pkg.exports !== "object") {
        return null;
      }
      return {
        packageUrl,
        exports: pkg.exports as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  })();
  return runningVeryfrontPackage;
}

async function resolveDenoVeryfrontImport(specifier: string): Promise<string> {
  const runningPackage = await loadRunningVeryfrontPackage();
  if (!runningPackage) return import.meta.resolve(specifier);

  return resolveVeryfrontPackageExport(specifier, runningPackage);
}

export function resolveVeryfrontPackageExport(
  specifier: string,
  runningPackage: RunningVeryfrontPackage,
): string {
  const exportKey = specifier === "veryfront" ? "." : `./${specifier.slice("veryfront/".length)}`;
  const exportPath = resolveExportEntry(runningPackage.exports[exportKey]);
  if (!exportPath) {
    throw new TypeError(`Veryfront package does not export ${exportKey}`);
  }

  const packageRoot = new URL("./", runningPackage.packageUrl);
  const resolved = new URL(exportPath, packageRoot);
  if (!resolved.href.startsWith(packageRoot.href)) {
    throw new TypeError(`Veryfront package export escapes its package root: ${exportKey}`);
  }
  return resolved.href;
}

export async function rewriteDenoVeryfrontImports(code: string): Promise<string> {
  const replacements = new Map<string, string>();

  for (const imported of await parseImports(code)) {
    const specifier = imported.n;
    if (
      typeof specifier !== "string" ||
      (specifier !== "veryfront" && !specifier.startsWith("veryfront/"))
    ) {
      continue;
    }

    replacements.set(specifier, await resolveDenoVeryfrontImport(specifier));
  }

  if (replacements.size === 0) return code;
  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier));
}

export async function rewriteExternalImports(
  code: string,
  projectDir: string,
  fs: SourceReader,
  userDeps: Map<string, string> = new Map(),
  helperPrefix: string = DEFAULT_ROUTE_HELPER_PREFIX,
): Promise<string> {
  let transformed = code;

  if (isNode) {
    try {
      transformed = await rewriteNodeExternalImports(transformed, projectDir, fs, userDeps);
    } catch (e) {
      rethrowProjectBoundaryViolation(e);
      logger.warn(`Failed to import node:module: ${redactedErrorMessage(e)}`);
    }
  }

  if (isDeno) {
    transformed = rewriteNpmImports(transformed, projectDir);
    transformed = rewriteDenoNodeBuiltinImports(transformed);

    if (!isCompiledBinary()) {
      transformed = await rewriteDenoVeryfrontImports(transformed);
    }

    // Rewrite user-installed npm dependencies.
    // In non-compiled Deno: use npm: specifiers (resolved by Deno's npm support).
    // In compiled binaries: load CJS packages from node_modules through the
    // compiled-binary `require` loader the module loader prepends after
    // bundling, since npm: specifiers only work for packages embedded at
    // compile time.
    if (isCompiledBinary()) {
      const esmDeps = await resolveEsmUserDependencies(projectDir, fs, userDeps);
      transformed = await rewriteCompiledBinaryUserDependencyImports(
        transformed,
        userDeps,
        esmDeps,
        helperPrefix,
      );
    } else {
      transformed = await rewriteDenoNpmDependencyImports(transformed, projectDir, fs, userDeps);
    }

    // In compiled binaries, "veryfront" resolves to embedded source that can't be
    // imported from external temp files. Rewrite to use local runtime shims.
    if (isCompiledBinary()) {
      transformed = rewriteCompiledBinaryVeryfrontImports(transformed);
    }
  }

  return transformed;
}
