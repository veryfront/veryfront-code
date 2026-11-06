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
  "validateImportOptions",
  "options",
  "tmp_",
  "reexport_",
] as const;
const ROUTE_HELPER_NAME =
  /\b__vf_(createRequire|dirname|resolve|interopDefault|namespace|validateImportOptions)\b/g;

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
var __vf_validateImportOptions;
var require = (function () {
// Route code shares this module scope, so a top-level route binding named like
// an intrinsic (\`const Set = ...\`) would shadow it here, or still be
// uninitialized when this runs. These locals come from the global object,
// which is reached through syntax alone.
var __vf_global = (function () {}).constructor("return this")();
var __vf_Deno = __vf_global.Deno;
var Error = __vf_global.Error, Function = __vf_global.Function;
var TypeError = __vf_global.TypeError;
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
var String = { fromCodePoint: __vf_global.String.fromCodePoint };
var parseInt = __vf_global.parseInt, SyntaxError = __vf_global.SyntaxError;
// Prototype methods are captured too, as plain functions taking the receiver
// first, so route or package code that replaces String, Array, RegExp or
// Function prototype methods cannot change how the loader behaves. The loader
// uses no regular expressions and no string methods that dispatch through
// Symbol.split, Symbol.replace or Symbol.search, which any string would reach.
var __vf_FunctionPrototype = Function.prototype;
var __vf_uncurry = __vf_FunctionPrototype.bind.bind(__vf_FunctionPrototype.call);
var __vf_invoke = __vf_uncurry(__vf_FunctionPrototype.call);
var __vf_bindTo = __vf_uncurry(__vf_FunctionPrototype.bind);
var __vf_StringPrototype = __vf_global.String.prototype;
var __vf_slice = __vf_uncurry(__vf_StringPrototype.slice);
var __vf_indexOf = __vf_uncurry(__vf_StringPrototype.indexOf);
var __vf_startsWith = __vf_uncurry(__vf_StringPrototype.startsWith);
var __vf_endsWith = __vf_uncurry(__vf_StringPrototype.endsWith);
var __vf_charCodeAt = __vf_uncurry(__vf_StringPrototype.charCodeAt);
var __vf_hasOwn = __vf_uncurry(__vf_Object.prototype.hasOwnProperty);
var __vf_hrefOf = __vf_uncurry(__vf_Object.getOwnPropertyDescriptor(__vf_global.URL.prototype, "href").get);
var Deno = {
  readTextFileSync: __vf_bindTo(__vf_Deno.readTextFileSync, __vf_Deno),
  realPathSync: __vf_bindTo(__vf_Deno.realPathSync, __vf_Deno),
  statSync: __vf_bindTo(__vf_Deno.statSync, __vf_Deno),
};
// Arrays are grown and shrunk by index, not with push or pop.
function __vf_append(list, value) {
  list[list.length] = value;
}
function __vf_removeLast(list) {
  if (list.length === 0) return void 0;
  var last = list[list.length - 1];
  list.length = list.length - 1;
  return last;
}
// Every occurrence of a literal search string replaced, without a regex.
function __vf_replaceAll(text, search, replacement) {
  var out = "";
  var from = 0;
  for (var at = __vf_indexOf(text, search); at !== -1; at = __vf_indexOf(text, search, from)) {
    out += __vf_slice(text, from, at) + replacement;
    from = at + search.length;
  }
  return out + __vf_slice(text, from);
}
function __vf_forwardSlashes(path) {
  return __vf_replaceAll(path, "\\\\", "/");
}
// The first index of a query or hash mark, or -1.
function __vf_suffixIndex(spec) {
  var query = __vf_indexOf(spec, "?");
  var hash = __vf_indexOf(spec, "#");
  if (query === -1) return hash;
  return hash === -1 || query < hash ? query : hash;
}
function __vf_isWordCode(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
    code === 95 || code === 36 || code > 127;
}
function __vf_isHexCode(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}
var __vf_builtinRequire = __vf_createRequire(__VF_PROJECT_DIR__ + "/package.json");
// Lookup tables are null-prototype objects rather than Set or Map, so route or
// package code that replaces a collection prototype method cannot change them.
function __vf_tableOf(names) {
  var table = Object.create(null);
  for (var i = 0; i < names.length; i++) table[names[i]] = true;
  return table;
}
var __vf_builtinSet = __vf_tableOf(__VF_BUILTIN_LIST__);
// Every built-in this runtime provides, not only the shared list. Node's
// prefix-only built-ins (node:test, node:sqlite, node:sea) have no bare form,
// so a package of that name still resolves from node_modules, even where the
// runtime lists the bare name.
var __vf_prefixOnlyBuiltins = __vf_tableOf(["sea", "sqlite", "test", "test/reporters"]);
try {
  var __vf_runtimeBuiltins = __vf_builtinRequire("node:module").builtinModules;
  for (var __vf_b = 0; __vf_b < __vf_runtimeBuiltins.length; __vf_b++) {
    var __vf_name = __vf_runtimeBuiltins[__vf_b];
    if (__vf_startsWith(__vf_name, "node:") || __vf_prefixOnlyBuiltins[__vf_name] === true) continue;
    __vf_builtinSet[__vf_name] = true;
  }
} catch (_) { /* expected: fall back to the shared list */ }
// Absolute ids include Windows drive-letter and UNC paths.
var __vf_isAbsolute = __vf_builtinRequire("node:path").isAbsolute;
function __vf_isPathId(id) {
  return __vf_startsWith(id, ".") || __vf_isAbsolute(id);
}
var __vf_projectRoot = __VF_PROJECT_ROOT__;
// VULN-FS-5: Canonicalize the project root so containment checks using
// Deno.realPathSync(resolved) compare canonical-vs-canonical. Without this,
// when the project itself is opened via a symlink, the realpath'd resolved
// module path has a different prefix than the non-canonical projectRoot and
// legitimate dependencies would be rejected.
try { __vf_projectRoot = Deno.realPathSync(__vf_projectRoot); } catch (_) { /* expected: projectRoot may not exist at shim init in some environments */ }
// File URLs for module-relative import() are built from the project root's URL,
// taken now, so no URL helper runs while route code may have replaced the
// prototype methods such helpers call.
var __vf_URL = __vf_global.URL;
var __vf_separator = __vf_builtinRequire("node:path").sep;
var __vf_projectRootHref = __vf_hrefOf(__vf_builtinRequire("node:url").pathToFileURL(__vf_projectRoot));
var __vf_urlEscapes = Object.create(null);
__vf_urlEscapes["%"] = "%25";
__vf_urlEscapes["\\\\"] = "%5C";
__vf_urlEscapes["\\n"] = "%0A";
__vf_urlEscapes["\\r"] = "%0D";
__vf_urlEscapes["\\t"] = "%09";
__vf_urlEscapes["?"] = "%3F";
__vf_urlEscapes["#"] = "%23";
// The file URL of a canonical path already checked to be inside the project,
// escaped as pathToFileURL escapes it.
function __vf_fileUrl(contained) {
  var relative = __vf_slice(contained, __vf_projectRoot.length);
  var encoded = "";
  for (var i = 0; i < relative.length; i++) {
    var c = relative[i];
    if (c === __vf_separator) encoded += "/";
    else encoded += __vf_urlEscapes[c] !== void 0 ? __vf_urlEscapes[c] : c;
  }
  if (encoded !== "" && encoded[0] !== "/" && !__vf_endsWith(__vf_projectRootHref, "/")) encoded = "/" + encoded;
  return __vf_hrefOf(new __vf_URL(__vf_projectRootHref + encoded));
}
var __vf_cache = Object.create(null);
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
    return Deno.realPathSync(parent) + __vf_slice(candidate, parent.length);
  } catch (_) { /* expected: parent may not exist either */ }
  return __vf_resolve(candidate);
}
// The error names the id the code asked for, never the resolved host path.
function __vf_assertContained(resolved, id) {
  var norm = __vf_forwardSlashes(__vf_resolve(resolved));
  var root = __vf_forwardSlashes(__vf_projectRoot);
  // A project at a filesystem root ("/", "C:/") already ends in a separator.
  var prefix = __vf_endsWith(root, "/") ? root : root + "/";
  if (!__vf_startsWith(norm, prefix) && norm !== root) {
    throw new Error("CJS loader blocked path outside project: " + JSON.stringify(id));
  }
}
function __vf_packageName(id) {
  var slash = __vf_indexOf(id, "/");
  if (slash !== -1 && __vf_startsWith(id, "@")) slash = __vf_indexOf(id, "/", slash + 1);
  return slash === -1 ? id : __vf_slice(id, 0, slash);
}
// Node's package "exports" resolution for require(): a target is undefined when nothing matched, null when the
// package blocks the subpath. Conditions are tried in the object's key order.
var __vf_requireConditions = __vf_tableOf(["require", "node", "node-addons", "default"]);
function __vf_exportsTarget(target, star) {
  if (typeof target === "string") {
    if (!__vf_startsWith(target, "./")) return null;
    var value = star === void 0 ? target : __vf_replaceAll(target, "*", star);
    if (__vf_indexOf(value, "\\\\") !== -1) return null;
    for (var from = 2; ; ) {
      var slash = __vf_indexOf(value, "/", from);
      var segment = __vf_slice(value, from, slash === -1 ? value.length : slash);
      if (segment === "" || segment === "." || segment === ".." || segment === "node_modules") return null;
      if (slash === -1) break;
      from = slash + 1;
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
  var dotKeys = 0;
  for (var d = 0; d < keys.length; d++) if (__vf_startsWith(keys[d], ".")) dotKeys++;
  if (dotKeys !== 0 && dotKeys !== keys.length) return null;
  var map = dotKeys === 0 ? { ".": exportsField } : exportsField;
  if (__vf_hasOwn(map, subpath) && __vf_indexOf(subpath, "*") === -1) {
    return __vf_exportsTarget(map[subpath], void 0);
  }
  var bestKey = null;
  var bestPrefix = -1;
  var bestStar;
  var patterns = Object.keys(map);
  for (var i = 0; i < patterns.length; i++) {
    var key = patterns[i];
    var starAt = __vf_indexOf(key, "*");
    if (starAt === -1 || __vf_indexOf(key, "*", starAt + 1) !== -1) continue;
    var prefix = __vf_slice(key, 0, starAt);
    var suffix = __vf_slice(key, starAt + 1);
    if (subpath.length < key.length || !__vf_startsWith(subpath, prefix) || !__vf_endsWith(subpath, suffix)) continue;
    if (prefix.length > bestPrefix || (prefix.length === bestPrefix && key.length > bestKey.length)) {
      bestKey = key;
      bestPrefix = prefix.length;
      bestStar = __vf_slice(subpath, prefix.length, subpath.length - suffix.length);
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
      var invalid = new Error("npm package " + JSON.stringify(name) + " could not be resolved (ERR_INVALID_PACKAGE_CONFIG)");
      invalid.code = "ERR_INVALID_PACKAGE_CONFIG";
      throw invalid;
    }
  }
  if (exportsField === void 0 || exportsField === null) {
    // A relative id keeps host paths out of any error it raises.
    return __vf_resolveLocal("./node_modules/" + id, dir);
  }
  var subpath = "." + __vf_slice(id, name.length);
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
// Bare ids resolve from the requiring module's directory, as Node does, so a
// package's own non-hoisted node_modules wins over the project root's copy.
// The loader walks node_modules itself instead of asking the runtime's
// resolver, which route code could change through built-in prototypes and
// which may claim names of prefix-only built-ins (test, sqlite, sea).
function __vf_resolveBare(id, parentDir) {
  if (__vf_startsWith(id, "node:")) {
    var unknown = new Error("Cannot find module " + JSON.stringify(id));
    unknown.code = "MODULE_NOT_FOUND";
    throw unknown;
  }
  var name = __vf_packageName(id);
  for (var dir = __vf_resolve(parentDir); ; dir = __vf_dirname(dir)) {
    var packageDir = __vf_resolve(dir, "node_modules", name);
    var exists = false;
    try { Deno.statSync(packageDir); exists = true; } catch (_) { /* expected: not installed at this level */ }
    if (exists) {
      try {
        return __vf_resolveInPackage(id, dir, packageDir);
      } catch (error) {
        if (!error || error.code !== "MODULE_NOT_FOUND") throw error;
        // Keep the code: packages probe optional dependencies with
        // \`error.code === "MODULE_NOT_FOUND"\`.
        var unresolved = new Error("npm package " + JSON.stringify(name) + " is installed but " + JSON.stringify(id) + " could not be resolved");
        unresolved.code = "MODULE_NOT_FOUND";
        throw unresolved;
      }
    }
    if (__vf_dirname(dir) === dir) break;
  }
  var missing = new Error("npm package " + JSON.stringify(name) + " is not installed in this runtime's node_modules");
  missing.code = "MODULE_NOT_FOUND";
  throw missing;
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
  // Only real built-ins are reserved under node:, as in Node.
  if (__vf_startsWith(id, "node:")) {
    var bare = __vf_slice(id, 5);
    return __vf_builtinSet[bare] === true || __vf_prefixOnlyBuiltins[bare] === true;
  }
  // Only the runtime's own built-in ids: "fs/promises" is a built-in, while
  // "fs/plugin" resolves from an installed package named fs, as in Node.
  return __vf_builtinSet[id] === true;
}
// Node's module.paths: each ancestor's node_modules, stopping at the project
// root so host directories above it are never listed. The directory is
// canonicalized first, so the walk meets the canonical root even when the
// project was opened through a symlink.
function __vf_isNodeModulesDir(dir) {
  if (!__vf_endsWith(dir, "node_modules")) return false;
  var before = dir[dir.length - 13];
  return dir.length === 12 || before === "/" || before === "\\\\";
}
function __vf_nodeModulePaths(dir) {
  var paths = [];
  var start = __vf_canonicalize(dir);
  try { __vf_assertContained(start, dir); } catch (_) { return paths; }
  for (var current = start; ; current = __vf_dirname(current)) {
    if (!__vf_isNodeModulesDir(current)) __vf_append(paths, __vf_resolve(current, "node_modules"));
    if (current === __vf_projectRoot || __vf_dirname(current) === current) break;
  }
  return paths;
}
// require.resolve(id) and require.resolve(id, { paths }): with paths, id
// resolves from each listed directory in turn. Either way a module result must
// stay inside the project, as loading it would, so no host path leaks out.
// The canonical path is returned, the same key require.cache uses.
function __vf_resolveContained(id, parentDir) {
  var found = __vf_resolveId(id, parentDir);
  if (__vf_isBuiltin(id) || __vf_isBuiltin(found)) return found;
  var canonical = __vf_canonicalize(found);
  __vf_assertContained(canonical, id);
  return canonical;
}
// require.resolve.paths(request): null for a built-in, the requiring
// directory for a relative request, otherwise its node_modules lookup paths.
function __vf_resolvePaths(request, parentDir) {
  if (__vf_isBuiltin(request)) return null;
  if (__vf_isPathId(request)) return [__vf_canonicalize(parentDir)];
  return __vf_nodeModulePaths(parentDir);
}
function __vf_resolveWithOptions(id, parentDir, options) {
  // Built-ins resolve to themselves, whatever search paths are given.
  if (__vf_isBuiltin(id)) return id;
  if (!options || options.paths === void 0) return __vf_resolveContained(id, parentDir);
  if (!Array.isArray(options.paths)) throw new TypeError("require.resolve options.paths must be an array");
  for (var i = 0; i < options.paths.length; i++) {
    try {
      // As in Node, a relative entry is taken from the working directory.
      return __vf_resolveContained(id, __vf_resolve(options.paths[i]));
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
var __vf_regexAfterWord = __vf_tableOf(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
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
      var lineEnd = __vf_indexOf(code, "\\n", i);
      i = lineEnd === -1 ? code.length : lineEnd;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      var blockEnd = __vf_indexOf(code, "*/", i + 2);
      i = blockEnd === -1 ? code.length : blockEnd + 2;
      continue;
    }
    return i;
  }
}
var __vf_simpleEscapes = Object.create(null);
__vf_simpleEscapes.b = "\\b";
__vf_simpleEscapes.f = "\\f";
__vf_simpleEscapes.n = "\\n";
__vf_simpleEscapes.r = "\\r";
__vf_simpleEscapes.t = "\\t";
__vf_simpleEscapes.v = "\\v";
__vf_simpleEscapes["0"] = "\\0";
// The end of a run of at most max hex digits starting at start.
function __vf_hexEnd(text, start, max) {
  var end = start;
  while (end < text.length && end - start < max && __vf_isHexCode(__vf_charCodeAt(text, end))) end++;
  return end;
}
// The value of a string literal's body, with its escapes decoded. A malformed
// escape keeps its character, as the specifier check only needs the prefix.
function __vf_decodeStringBody(body) {
  var out = "";
  for (var i = 0; i < body.length; i++) {
    var c = body[i];
    if (c !== "\\\\") { out += c; continue; }
    if (++i >= body.length) { out += c; break; }
    var next = body[i];
    var end;
    if (next === "u" && body[i + 1] === "{") {
      end = __vf_hexEnd(body, i + 2, body.length);
      if (end > i + 2 && body[end] === "}") {
        out += String.fromCodePoint(parseInt(__vf_slice(body, i + 2, end), 16));
        i = end;
        continue;
      }
    } else if (next === "u" || next === "x") {
      var digits = next === "u" ? 4 : 2;
      end = __vf_hexEnd(body, i + 1, digits);
      if (end === i + 1 + digits) {
        out += String.fromCodePoint(parseInt(__vf_slice(body, i + 1, end), 16));
        i = end - 1;
        continue;
      }
    }
    // A line continuation adds nothing to the value.
    if (next === "\\r" && body[i + 1] === "\\n") { i++; continue; }
    if (next === "\\n" || next === "\\r" || next === "\\u2028" || next === "\\u2029") continue;
    out += __vf_simpleEscapes[next] !== void 0 ? __vf_simpleEscapes[next] : next;
  }
  return out;
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
  var spec = __vf_decodeStringBody(__vf_slice(code, quoteAt + 1, end - 1));
  if (!__vf_startsWith(spec, "./") && !__vf_startsWith(spec, "../") && !__vf_startsWith(spec, "/")) return null;
  return { end: end, spec: spec };
}
function __vf_rewriteCjsDynamicImports(code, helperName) {
  if (__vf_indexOf(code, "import") === -1) return code;
  var out = "";
  var copied = 0;
  // "" or a punctuator: the last significant token; "word" and "value" mean an
  // identifier or literal ended, after which "/" divides.
  var previous = "";
  var stack = [];
  var parens = [];
  var controlWord = false;
  var i = 0;
  while (i < code.length) {
    var c = code[i];
    if (c === " " || c === "\\t" || c === "\\n" || c === "\\r") { i++; continue; }
    if (c === "/" && code[i + 1] === "/") {
      var lineEnd = __vf_indexOf(code, "\\n", i);
      i = lineEnd === -1 ? code.length : lineEnd;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      var blockEnd = __vf_indexOf(code, "*/", i + 2);
      i = blockEnd === -1 ? code.length : blockEnd + 2;
      continue;
    }
    if (c === "'" || c === '"') { i = __vf_skipQuoted(code, i, c); previous = "value"; continue; }
    if (c === "\`" || (c === "}" && stack[stack.length - 1] === "\${")) {
      // A template, or its continuation after a substitution.
      if (c === "}") __vf_removeLast(stack);
      var substitution = false;
      for (i++; i < code.length; i++) {
        if (code[i] === "\\\\") { i++; continue; }
        if (code[i] === "\`") { i++; break; }
        if (code[i] === "$" && code[i + 1] === "{") { __vf_append(stack, "\${"); i += 2; substitution = true; break; }
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
    if (__vf_isWordCode(__vf_charCodeAt(code, i))) {
      var start = i;
      while (i < code.length && __vf_isWordCode(__vf_charCodeAt(code, i))) i++;
      var word = __vf_slice(code, start, i);
      // Not a property (obj.import) or a private name (this.#import).
      if (word === "import" && previous !== "." && previous !== "#") {
        var call = __vf_matchRelativeImport(code, i);
        if (call) {
          out += __vf_slice(code, copied, start) + helperName + "(" + JSON.stringify(call.spec);
          copied = i = call.end;
          previous = "value";
          continue;
        }
      }
      previous = __vf_regexAfterWord[word] === true ? "(" : "word";
      controlWord = word === "if" || word === "while" || word === "for" || word === "with";
      continue;
    }
    // A ")" closing an if/while/for/with condition starts a statement, where
    // "/" begins a regex literal; any other ")" ends a value.
    // "++" and "--" after a value are postfix and end that value, so a "/"
    // after them divides; before a value they are prefix operators.
    if ((c === "+" || c === "-") && code[i + 1] === c) {
      var afterValue = previous === "word" || previous === "value" || previous === ")" || previous === "]";
      previous = afterValue ? "value" : c;
      controlWord = false;
      i += 2;
      continue;
    }
    if (c === "(") __vf_append(parens, controlWord);
    controlWord = false;
    if (c === "{") __vf_append(stack, "{");
    else if (c === "}") __vf_removeLast(stack);
    previous = c === ")" && __vf_removeLast(parens) === true ? "(" : c;
    i++;
  }
  return copied === 0 ? code : out + __vf_slice(code, copied);
}
function __vf_importFrom(spec, parentDir, options) {
  return (async function () {
    // A query or hash belongs to the module URL, not to the file path.
    var suffixAt = __vf_suffixIndex(spec);
    var path = suffixAt === -1 ? spec : __vf_slice(spec, 0, suffixAt);
    var target = __vf_canonicalize(__vf_resolve(parentDir, path));
    __vf_assertContained(target, spec);
    var url = __vf_fileUrl(target) + (suffixAt === -1 ? "" : __vf_slice(spec, suffixAt));
    try {
      return options === void 0 ? await import(url) : await import(url, options);
    } catch (error) {
      // A load failure for this file names its host path; report the
      // specifier the package wrote instead.
      var message = error && typeof error.message === "string" ? error.message : "";
      if (__vf_indexOf(message, __vf_projectRoot) === -1 && __vf_indexOf(message, __vf_projectRootHref) === -1) throw error;
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
  return __vf_charCodeAt(text, 0) === 0xFEFF ? __vf_slice(text, 1) : text;
}
// As in Node, every required module records the module that first required it
// as module.parent, and each requiring module lists it once in module.children.
// Index loops instead of Array prototype methods, which package code can replace.
function __vf_childIndex(parentMod, mod) {
  var children = parentMod.children;
  for (var i = 0; i < children.length; i++) if (children[i] === mod) return i;
  return -1;
}
function __vf_linkChild(parentMod, mod) {
  if (parentMod && __vf_childIndex(parentMod, mod) === -1) parentMod.children[parentMod.children.length] = mod;
}
function __vf_loadCjs(id, parentDir, parentMod) {
  if (__vf_isBuiltin(id)) return __vf_builtinRequire(id);
  var resolved;
  if (__vf_isPathId(id)) {
    resolved = __vf_resolveLocal(id, parentDir);
  } else {
    resolved = __vf_resolveBare(id, parentDir);
  }
  if (__vf_endsWith(resolved, ".node")) {
    throw new Error("native addon " + JSON.stringify(id) + " cannot be loaded: native addons are not supported in this runtime");
  }
  if (__vf_endsWith(resolved, ".mjs")) {
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
  if (__vf_endsWith(resolved, ".json")) {
    var json = JSON.parse(code);
    var jsonMod = { exports: json, id: resolved, filename: resolved, loaded: true, children: [], parent: parentMod };
    __vf_cache[resolved] = jsonMod;
    __vf_linkChild(parentMod, jsonMod);
    return json;
  }
  // Node strips a leading hashbang from CommonJS sources; a Function body
  // cannot contain one. Commenting it out keeps line numbers intact.
  if (__vf_startsWith(code, "#!")) code = "//" + __vf_slice(code, 2);
  var dir = __vf_dirname(resolved);
  // The helper's name is one the package's source never mentions, so no
  // binding of the package can shadow it at a rewritten import.
  var importHelper = "__vf_cjsImport";
  while (__vf_indexOf(code, importHelper) !== -1) importHelper += "_";
  code = __vf_rewriteCjsDynamicImports(code, importHelper);
  var cjsImport = function (spec, options) { return __vf_importFrom(spec, dir, options); };
  var mod;
  var childReq = function(childId) { return __vf_loadCjs(childId, dir, mod); };
  childReq.resolve = function(childId, options) { return __vf_resolveWithOptions(childId, dir, options); };
  childReq.ensure = function(mods, cb) { cb(); };
  childReq.cache = __vf_cache;
  childReq.resolve.paths = function(request) { return __vf_resolvePaths(request, dir); };
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
    __vf_invoke(fn, mod.exports, mod.exports, childReq, mod, resolved, dir);
  } catch (error) {
    delete __vf_cache[resolved];
    if (parentMod) {
      var childIdx = __vf_childIndex(parentMod, mod);
      if (childIdx !== -1) {
        var siblings = parentMod.children;
        for (var k = childIdx; k < siblings.length - 1; k++) siblings[k] = siblings[k + 1];
        siblings.length = siblings.length - 1;
      }
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
routeRequire.cache = __vf_cache;
routeRequire.resolve.paths = function(request) { return __vf_resolvePaths(request, __vf_projectRoot); };
routeModule.require = routeRequire;
// One namespace per resolved module, as with ES module namespaces: repeated
// imports of a module share it, and distinct modules never do. As with native
// CommonJS interop, \`default\` is the whole module.exports, also for modules
// marked __esModule.
var namespaces = Object.create(null);
// import() rejects options that are not an object, a "with" value that is not
// an object, a non-string attribute value, and attributes it does not support.
// The only supported type is "json", and only for a JSON module.
__vf_validateImportOptions = function (options, id) {
  if (options === void 0) return;
  if (options === null || (typeof options !== "object" && typeof options !== "function")) {
    throw new TypeError("The second argument to import() must be an object");
  }
  var attributes = options.with;
  if (attributes === void 0) return;
  if (attributes === null || (typeof attributes !== "object" && typeof attributes !== "function")) {
    throw new TypeError("The 'with' option of import() must be an object");
  }
  var keys = Object.keys(attributes);
  for (var i = 0; i < keys.length; i++) {
    if (typeof attributes[keys[i]] !== "string") {
      throw new TypeError("Import attribute " + JSON.stringify(keys[i]) + " must be a string");
    }
    if (keys[i] !== "type") {
      throw new SyntaxError("Unsupported import attribute " + JSON.stringify(keys[i]));
    }
  }
  var type = attributes.type;
  if (type === void 0) return;
  if (type !== "json") {
    throw new TypeError("Import attribute type " + JSON.stringify(type) + " is not supported");
  }
  if (id !== void 0 && (__vf_isBuiltin(id) || !__vf_endsWith(__vf_resolveId(id, __VF_PROJECT_DIR__), ".json"))) {
    throw new TypeError("Module " + JSON.stringify(id) + " is not a JSON module, but was imported with type json");
  }
};
__vf_namespace = function (id) {
  var key = __vf_isBuiltin(id)
    ? "builtin:" + (__vf_startsWith(id, "node:") ? __vf_slice(id, 5) : id)
    : __vf_canonicalize(__vf_resolveId(id, __VF_PROJECT_DIR__));
  if (key in namespaces) return namespaces[key];
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
  namespaces[key] = ns;
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
