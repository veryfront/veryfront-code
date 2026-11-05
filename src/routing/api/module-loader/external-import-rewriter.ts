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
  let shim = withRouteHelperPrefix(COMPILED_BINARY_REQUIRE_SHIM_TEMPLATE, helperPrefix);
  for (const [placeholder, literal] of Object.entries(literals)) {
    shim = shim.split(placeholder).join(literal);
  }
  return shim;
}

const COMPILED_BINARY_REQUIRE_SHIM_TEMPLATE = `
import { createRequire as __vf_createRequire } from "node:module";
import { dirname as __vf_dirname, resolve as __vf_resolve } from "node:path";
var __vf_namespace;
var require = (function () {
var __vf_builtinRequire = __vf_createRequire(__VF_PROJECT_DIR__ + "/package.json");
var __vf_builtinSet = new Set(__VF_BUILTIN_LIST__);
// Every built-in this runtime provides, not only the shared list.
try {
  var __vf_runtimeBuiltins = __vf_builtinRequire("node:module").builtinModules;
  for (var __vf_b = 0; __vf_b < __vf_runtimeBuiltins.length; __vf_b++) {
    __vf_builtinSet.add(__vf_runtimeBuiltins[__vf_b].replace(/^node:/, ""));
  }
} catch (_) { /* expected: fall back to the shared list */ }
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
  if (!norm.startsWith(root + "/") && norm !== root) {
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
function __vf_resolveBare(id, parentDir) {
  try {
    return __vf_parentRequire(parentDir).resolve(id);
  } catch (error) {
    // The resolver's message carries host paths in its require stack. Name
    // only what the route asked for, and say "not installed" only when no
    // node_modules on the lookup path has the package at all.
    if (!error || error.code !== "MODULE_NOT_FOUND") throw error;
    var name = __vf_packageName(id);
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
  var candidates = [path, path + ".js", path + ".cjs", path + ".json"];
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
    var main;
    try { main = JSON.parse(Deno.readTextFileSync(manifest)).main; } catch (_) { /* expected: unreadable manifest falls back to index */ }
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
  if (__vf_builtinSet.has(id)) return true;
  var slashIdx = id.indexOf("/");
  return slashIdx > 0 && __vf_builtinSet.has(id.slice(0, slashIdx));
}
function __vf_loadCjs(id, parentDir) {
  if (__vf_isBuiltin(id)) return __vf_builtinRequire(id);
  var resolved;
  if (id.startsWith(".") || id.startsWith("/")) {
    resolved = __vf_resolveLocal(id, parentDir);
  } else {
    resolved = __vf_resolveBare(id, parentDir);
  }
  if (resolved.endsWith(".node")) {
    throw new Error("native addon " + JSON.stringify(id) + " cannot be loaded: native addons are not supported in this runtime");
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
  if (resolved in __vf_cache) return __vf_cache[resolved];
  var code = Deno.readTextFileSync(resolved);
  if (resolved.endsWith(".json")) {
    var json = JSON.parse(code);
    __vf_cache[resolved] = json;
    return json;
  }
  // Node strips a leading hashbang from CommonJS sources; a Function body
  // cannot contain one. Commenting it out keeps line numbers intact.
  if (code.startsWith("#!")) code = "//" + code.slice(2);
  var mod = { exports: {} };
  __vf_cache[resolved] = mod.exports;
  var dir = __vf_dirname(resolved);
  var childReq = function(childId) { return __vf_loadCjs(childId, dir); };
  childReq.resolve = function(childId) { return __vf_resolveId(childId, dir); };
  childReq.ensure = function(mods, cb) { cb(); };
  // As in Node, top-level \`this\` is module.exports, and a module whose
  // evaluation throws is dropped from the cache so a retry fails again.
  try {
    var fn = new Function("exports", "require", "module", "__filename", "__dirname", "global", "globalThis", "Worker", code);
    fn.call(mod.exports, mod.exports, childReq, mod, resolved, dir, globalThis, globalThis, undefined);
  } catch (error) {
    delete __vf_cache[resolved];
    throw error;
  }
  __vf_cache[resolved] = mod.exports;
  return mod.exports;
}
function __vf_resolveId(id, parentDir) {
  if (id.startsWith(".") || id.startsWith("/")) return __vf_resolveLocal(id, parentDir);
  return __vf_resolveBare(id, parentDir);
}
var routeRequire = function(id) { return __vf_loadCjs(id, __VF_PROJECT_DIR__); };
routeRequire.resolve = function(id) { return __vf_resolveId(id, __VF_PROJECT_DIR__); };
routeRequire.ensure = function(mods, cb) { cb(); };
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
    for (var name in m) if (name !== "default") ns[name] = m[name];
  }
  ns.default = m;
  namespaces.set(key, ns);
  return ns;
};
return routeRequire;
})();
function __vf_interopDefault(m) { return m && m.__esModule && m.default !== undefined ? m.default : m; }
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
