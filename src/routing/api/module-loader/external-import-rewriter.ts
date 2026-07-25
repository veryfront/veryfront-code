import { isCompiledBinary, serverLogger } from "#veryfront/utils";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { rewriteNpmImports } from "#veryfront/transforms/npm-import-rewrites.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import {
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

const logger = serverLogger.component("api");

/** Node.js built-in module names — shared across the CJS shim, esbuild externals, and Deno rewrites. */
export const NODE_BUILTINS = ROUTE_NODE_BUILTINS;

export async function readProjectDependencies(
  projectDir: string,
  fs: FileSystem,
): Promise<Map<string, string>> {
  return await readProjectDependenciesForRoute(projectDir, fs);
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
 */
export function generateCompiledBinaryRequireShim(projectDir: string): string {
  const builtinSet = JSON.stringify(NODE_BUILTINS);
  const safeProjectDir = JSON.stringify(projectDir + "/package.json");
  const safeProjectRoot = JSON.stringify(pathHelper.resolve(projectDir));

  return `
import { createRequire as __vf_createRequire } from "node:module";
import { dirname as __vf_dirname, resolve as __vf_resolve } from "node:path";
var __vf_builtinRequire = __vf_createRequire(${safeProjectDir});
var __vf_builtinSet = new Set(${builtinSet});
var __vf_projectRoot = ${safeProjectRoot};
// VULN-FS-5: Canonicalize the project root so containment checks using
// Deno.realPathSync(resolved) compare canonical-vs-canonical. Without this,
// when the project itself is opened via a symlink, the realpath'd resolved
// module path has a different prefix than the non-canonical projectRoot and
// legitimate dependencies would be rejected.
try { __vf_projectRoot = Deno.realPathSync(__vf_projectRoot); } catch (_) { /* expected: projectRoot may not exist at shim init in some environments */ }
var __vf_cache = Object.create(null);
function __vf_assertContained(resolved) {
  var norm = __vf_resolve(resolved).replace(/\\\\/g, "/");
  var root = __vf_projectRoot.replace(/\\\\/g, "/");
  if (!norm.startsWith(root + "/") && norm !== root) {
    throw new Error("CJS loader blocked path outside project: " + resolved);
  }
}
function __vf_loadCjs(id, parentDir) {
  if (id.startsWith("node:")) return __vf_builtinRequire(id);
  if (__vf_builtinSet.has(id)) return __vf_builtinRequire(id);
  var slashIdx = id.indexOf("/");
  if (slashIdx > 0 && __vf_builtinSet.has(id.slice(0, slashIdx))) return __vf_builtinRequire(id);
  var resolved;
  if (id.startsWith(".") || id.startsWith("/")) {
    resolved = __vf_resolve(parentDir, id);
    if (!resolved.match(/\\.[a-zA-Z0-9]+$/)) {
      var exts = [".js", ".cjs", ".json", "/index.js", "/index.cjs", "/index.json"];
      for (var i = 0; i < exts.length; i++) {
        try { Deno.statSync(resolved + exts[i]); resolved += exts[i]; break; } catch (_) { /* expected: probing file extensions */ }
      }
    }
  } else {
    resolved = __vf_builtinRequire.resolve(id);
  }
  // VULN-FS-5: Always assert containment after resolution (both branches),
  // then re-canonicalize via realPathSync to resist symlinked node_modules
  // entries that could point outside the project root.
  __vf_assertContained(resolved);
  try {
    var real = Deno.realPathSync(resolved);
    __vf_assertContained(real);
    resolved = real;
  } catch (_) {
    /* expected: realPathSync fails for non-existent paths — assertContained above already held */
  }
  if (resolved in __vf_cache) return __vf_cache[resolved];
  var code = Deno.readTextFileSync(resolved);
  if (resolved.endsWith(".json")) {
    var json = JSON.parse(code);
    __vf_cache[resolved] = json;
    return json;
  }
  var mod = { exports: {} };
  __vf_cache[resolved] = mod.exports;
  var dir = __vf_dirname(resolved);
  var childReq = function(childId) { return __vf_loadCjs(childId, dir); };
  childReq.resolve = function(childId) {
    if (childId.startsWith(".") || childId.startsWith("/")) return __vf_resolve(dir, childId);
    return __vf_builtinRequire.resolve(childId);
  };
  childReq.ensure = function(mods, cb) { cb(); };
  var fn = new Function("exports", "require", "module", "__filename", "__dirname", "global", "globalThis", "Worker", code);
  fn(mod.exports, childReq, mod, resolved, dir, globalThis, globalThis, undefined);
  __vf_cache[resolved] = mod.exports;
  return mod.exports;
}
function __vf_interopDefault(m) { return m && m.__esModule && m.default !== undefined ? m.default : m; }
var require = function(id) { return __vf_loadCjs(id, ${JSON.stringify(projectDir)}); };
require.resolve = function(id) { return __vf_builtinRequire.resolve(id); };
require.ensure = function(mods, cb) { cb(); };
`.trim();
}

export function getNodeExternalPackagesToResolve(userDeps: Map<string, string>): string[] {
  return getNodeExternalPackagesToResolveForRoute(userDeps);
}

export async function resolveNodePackageToFileUrl(
  projectDir: string,
  packageName: string,
  fs: FileSystem,
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
  } catch (_) {
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
  fs: FileSystem,
  userDeps: Map<string, string>,
): Promise<Map<string, EsmDependencyLocation>> {
  return await resolveEsmUserDependenciesForRoute(projectDir, fs, userDeps);
}

export async function loadVeryfrontExportsMap(
  projectDir: string,
  fs: FileSystem,
): Promise<Record<string, { import?: string }>> {
  const vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
  const vfPackageJsonPath = pathHelper.join(vfPackagePath, "package.json");

  try {
    const pkgJson = JSON.parse(await fs.readTextFile(vfPackageJsonPath));
    return pkgJson.exports || {};
  } catch (_error) {
    logger.debug("Could not read veryfront package.json");
    return {};
  }
}

export async function rewriteNodeExternalImports(
  code: string,
  projectDir: string,
  fs: FileSystem,
  userDeps: Map<string, string>,
): Promise<string> {
  const { pathToFileURL } = await import("node:url");
  const replacements = new Map<string, string>();

  logger.debug(`Rewriting external imports for Node.js, projectDir: ${projectDir}`);

  const importedSpecifiers = new Set(
    (await parseImports(code))
      .map((imp) => imp.n)
      .filter((specifier): specifier is string => typeof specifier === "string"),
  );
  const packages = getNodeExternalPackagesToResolve(userDeps);

  for (const specifier of importedSpecifiers) {
    const pkg = packages.find((name) => specifier === name || specifier.startsWith(`${name}/`));
    if (!pkg) continue;

    const subpath = specifier.slice(pkg.length);
    if (subpath) {
      const packageDir = pathToFileURL(pathHelper.join(projectDir, "node_modules", pkg)).href;
      const resolvedSubpath = `${packageDir}${subpath}`;
      logger.debug(`Resolved ${specifier} -> ${resolvedSubpath}`);
      replacements.set(specifier, resolvedSubpath);
      continue;
    }

    const resolvedUrl = await resolveNodePackageToFileUrl(projectDir, pkg, fs, pathToFileURL);
    if (!resolvedUrl) continue;
    logger.debug(`Resolved ${pkg} -> ${resolvedUrl}`);
    replacements.set(specifier, resolvedUrl);
  }

  const vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
  const exportsMap = await loadVeryfrontExportsMap(projectDir, fs);

  for (const specifier of importedSpecifiers) {
    if (specifier === "veryfront") {
      const exportEntry = exportsMap["."];
      if (!exportEntry?.import) continue;

      const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
      logger.debug(`Resolved veryfront -> ${resolvedPath}`);
      replacements.set(specifier, pathToFileURL(resolvedPath).href);
      continue;
    }

    if (specifier.startsWith("veryfront/")) {
      const subpath = "./" + specifier.replace("veryfront/", "");
      const exportEntry = exportsMap[subpath];
      if (!exportEntry?.import) {
        logger.warn(`No export found for ${subpath}`);
        continue;
      }

      const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
      logger.debug(`Resolved ${specifier} -> ${resolvedPath}`);
      replacements.set(specifier, pathToFileURL(resolvedPath).href);
    }
  }

  if (replacements.size === 0) return code;

  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier));
}

export function rewriteCompiledBinaryVeryfrontImports(code: string): string {
  return rewriteCompiledVeryfrontImportsForRoute(code);
}

export function rewriteCompiledBinaryUserDependencyImports(
  code: string,
  userDeps: Map<string, string>,
  esmDeps: Map<string, EsmDependencyLocation> = new Map(),
): string {
  return rewriteCompiledUserDependencyImportsForRoute(code, userDeps, esmDeps);
}

export async function rewriteDenoNpmDependencyImports(
  code: string,
  projectDir: string,
  fs: FileSystem,
  userDeps: Map<string, string>,
): Promise<string> {
  return await rewriteDenoNpmDependencyImportsForRoute(code, projectDir, fs, userDeps);
}

export function rewriteDenoNodeBuiltinImports(code: string): string {
  return rewriteDenoNodeBuiltinsForRoute(code);
}

export async function rewriteExternalImports(
  code: string,
  projectDir: string,
  fs: FileSystem,
  userDeps: Map<string, string> = new Map(),
): Promise<string> {
  let transformed = code;

  if (isNode) {
    try {
      transformed = await rewriteNodeExternalImports(transformed, projectDir, fs, userDeps);
    } catch (e) {
      logger.warn(`Failed to import node:module: ${e}`);
    }
  }

  if (isDeno) {
    transformed = rewriteNpmImports(transformed, projectDir);
    transformed = rewriteDenoNodeBuiltinImports(transformed);

    // Rewrite user-installed npm dependencies.
    // In non-compiled Deno: use npm: specifiers (resolved by Deno's npm support).
    // In compiled binaries: use the createRequire-based `require` shim (already
    // injected by the esbuild banner) to load CJS packages from node_modules,
    // since npm: specifiers only work for packages embedded at compile time.
    if (isCompiledBinary()) {
      const esmDeps = await resolveEsmUserDependencies(projectDir, fs, userDeps);
      transformed = rewriteCompiledBinaryUserDependencyImports(transformed, userDeps, esmDeps);
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
