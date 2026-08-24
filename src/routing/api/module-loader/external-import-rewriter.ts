import { isCompiledBinary, serverLogger } from "#veryfront/utils";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { rewriteNpmImports } from "#veryfront/transforms/npm-import-rewrites.ts";
import { resolveContainedPackagePath } from "#veryfront/transforms/import-rewriter/package-resolution.ts";
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
import { rethrowProjectBoundaryViolation } from "./project-source-snapshot.ts";

const logger = serverLogger.component("api");
type SourceReader = Pick<FileSystem, "readTextFile">;

/** Node.js built-in module names — shared across the CJS shim, esbuild externals, and Deno rewrites. */
export const NODE_BUILTINS = ROUTE_NODE_BUILTINS;

export async function readProjectDependencies(
  projectDir: string,
  fs: Pick<FileSystem, "readTextFile">,
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
  var real;
  try {
    real = Deno.realPathSync(resolved);
  } catch (_) {
    /* expected: realPathSync fails for non-existent paths — assertContained above already held */
  }
  if (real !== undefined) {
    __vf_assertContained(real);
    resolved = real;
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
      // The subpath comes from the handler source; reject any that escape the
      // package directory (e.g. "pkg/../../secret") by leaving the import
      // untouched so it fails to resolve rather than reading outside
      // node_modules.
      const packageDir = pathHelper.join(projectDir, "node_modules", pkg);
      const target = resolveContainedPackagePath(packageDir, `.${subpath}`);
      if (!target) {
        logger.warn(`Skipping subpath import that escapes package directory: ${specifier}`);
        continue;
      }
      const resolvedSubpath = pathToFileURL(target).href;
      logger.debug(`Resolved ${specifier} -> ${resolvedSubpath}`);
      replacements.set(specifier, resolvedSubpath);
      continue;
    }

    const resolvedUrl = await resolveNodePackageToFileUrl(projectDir, pkg, fs, pathToFileURL);
    if (!resolvedUrl) continue;
    logger.debug(`Resolved ${pkg} -> ${resolvedUrl}`);
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
      logger.debug(`Resolved ${specifier} -> ${resolvedPath}`);
      replacements.set(specifier, pathToFileURL(resolvedPath).href);
    };

    for (const specifier of veryfrontSpecifiers) {
      const subpath = specifier === "veryfront" ? "." : "./" + specifier.slice("veryfront/".length);

      if (runningPackage) {
        try {
          const resolved = resolveVeryfrontPackageExport(specifier, runningPackage);
          logger.debug(`Resolved ${specifier} -> ${resolved} (running package)`);
          replacements.set(specifier, resolved);
          continue;
        } catch (error) {
          logger.warn(
            `Running package does not export ${specifier} (${String(error)}); ` +
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
): Promise<string> {
  let transformed = code;

  if (isNode) {
    try {
      transformed = await rewriteNodeExternalImports(transformed, projectDir, fs, userDeps);
    } catch (e) {
      rethrowProjectBoundaryViolation(e);
      logger.warn(`Failed to import node:module: ${e}`);
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
