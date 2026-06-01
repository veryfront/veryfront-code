import { isCompiledBinary, serverLogger } from "#veryfront/utils";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { rewriteNpmImports } from "#veryfront/transforms/npm-import-rewrites.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import { resolveExportEntry, toCjsDestructureBindings } from "./loader-helpers.ts";

const logger = serverLogger.component("api");

/** Node.js built-in module names — shared across the CJS shim, esbuild externals, and Deno rewrites. */
export const NODE_BUILTINS = [
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
] as const;

export async function readProjectDependencies(
  projectDir: string,
  fs: FileSystem,
): Promise<Map<string, string>> {
  try {
    const content = await fs.readTextFile(pathHelper.join(projectDir, "package.json"));
    const pkg = JSON.parse(content) as { dependencies?: Record<string, string> };
    return new Map(Object.entries(pkg.dependencies ?? {}));
  } catch (_) {
    /* expected: package.json may not exist */
    return new Map();
  }
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
  const externalPackagesToResolve = ["zod"];

  for (const name of userDeps.keys()) {
    if (!externalPackagesToResolve.includes(name)) {
      externalPackagesToResolve.push(name);
    }
  }

  return externalPackagesToResolve;
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

/** Location of an ESM-only user dependency, used to rewrite imports to real ES module URLs. */
export interface EsmDependencyLocation {
  /** file:// URL of the package's ESM entry point. */
  entryUrl: string;
  /** Absolute path of the package's root directory (used to contain subpath imports). */
  packageDir: string;
}

/**
 * Decide whether an installed package must be loaded as a real ES module.
 *
 * ESM-only packages (e.g. `"type": "module"` packages that use `import.meta` or
 * top-level await) cannot be evaluated as CommonJS via the compiled-binary
 * `new Function` shim. We treat a package as ESM when its package.json declares
 * `"type": "module"` or its resolved entry point is a `.mjs` file.
 */
function isEsmPackage(pkgJson: Record<string, unknown>, entry: string): boolean {
  if (pkgJson.type === "module") return true;
  return entry.endsWith(".mjs");
}

/**
 * Resolve a package's ESM entry point, preferring the conditional `import`
 * export, then the `module` field, then `main`.
 */
function resolveEsmEntry(pkgJson: Record<string, unknown>): string | undefined {
  const exportsField = pkgJson.exports;
  if (exportsField && typeof exportsField === "object") {
    const dot = (exportsField as Record<string, unknown>)["."];
    const fromExports = resolveExportEntry(dot ?? exportsField);
    if (fromExports) return fromExports;
  } else if (typeof exportsField === "string") {
    return exportsField;
  }

  const moduleField = pkgJson.module;
  if (typeof moduleField === "string") return moduleField;
  const mainField = pkgJson.main;
  if (typeof mainField === "string") return mainField;
  return "index.js";
}

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
  const esmDeps = new Map<string, EsmDependencyLocation>();

  for (const name of userDeps.keys()) {
    const packageDir = pathHelper.resolve(pathHelper.join(projectDir, "node_modules", name));
    try {
      const pkgJson = JSON.parse(
        await fs.readTextFile(pathHelper.join(packageDir, "package.json")),
      ) as Record<string, unknown>;

      const entry = resolveEsmEntry(pkgJson);
      if (!entry || !isEsmPackage(pkgJson, entry)) continue;

      // The entry path comes from the dependency's own package.json, which is
      // attacker-influenceable (a malicious/compromised package could set
      // "main": "../../../etc/passwd"). Reject entries that resolve outside the
      // package directory so a crafted package.json cannot turn into a file://
      // import that escapes node_modules. This mirrors the containment guard the
      // CJS loader shim enforces via __vf_assertContained.
      const entryPath = pathHelper.resolve(pathHelper.join(packageDir, entry));
      if (!isWithinDirectory(packageDir, entryPath)) {
        logger.warn(`Skipping ESM dependency ${name}: entry escapes package directory (${entry})`);
        continue;
      }

      esmDeps.set(name, {
        entryUrl: pathHelper.toFileUrl(entryPath).href,
        packageDir,
      });
    } catch (_) {
      /* expected: package.json missing/invalid → treat as CJS */
    }
  }

  return esmDeps;
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
  let transformed = code;

  logger.debug(`Rewriting external imports for Node.js, projectDir: ${projectDir}`);

  for (const pkg of getNodeExternalPackagesToResolve(userDeps)) {
    const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const staticImportRegex = new RegExp(`from\\s*["']${escapedPkg}(/[^"']*)?["']`, "g");
    const dynamicImportRegex = new RegExp(
      `import\\s*\\(\\s*["']${escapedPkg}(/[^"']*)?["']\\s*\\)`,
      "g",
    );

    const needsStatic = staticImportRegex.test(transformed);
    staticImportRegex.lastIndex = 0;
    const needsDynamic = dynamicImportRegex.test(transformed);
    dynamicImportRegex.lastIndex = 0;
    if (!needsStatic && !needsDynamic) continue;

    const packageDir = pathToFileURL(pathHelper.join(projectDir, "node_modules", pkg)).href;
    const resolvedUrl = await resolveNodePackageToFileUrl(projectDir, pkg, fs, pathToFileURL);

    if (needsStatic) {
      transformed = transformed.replace(staticImportRegex, (_, subpath) => {
        if (subpath) {
          const subUrl = `${packageDir}${subpath}`;
          logger.debug(`Resolved ${pkg}${subpath} -> ${subUrl}`);
          return `from "${subUrl}"`;
        }
        if (!resolvedUrl) return `from "${pkg}"`;
        logger.debug(`Resolved ${pkg} -> ${resolvedUrl}`);
        return `from "${resolvedUrl}"`;
      });
    }

    if (needsDynamic) {
      transformed = transformed.replace(dynamicImportRegex, (_, subpath) => {
        if (subpath) {
          return `import("${packageDir}${subpath}")`;
        }
        if (!resolvedUrl) return `import("${pkg}")`;
        return `import("${resolvedUrl}")`;
      });
    }
  }

  const vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
  const exportsMap = await loadVeryfrontExportsMap(projectDir, fs);

  transformed = transformed.replace(
    /from\s+["'](veryfront\/[^"']+)["']/g,
    (match, fullSpecifier: string) => {
      const subpath = "./" + fullSpecifier.replace("veryfront/", "");
      const exportEntry = exportsMap[subpath];
      if (!exportEntry?.import) {
        logger.warn(`No export found for ${subpath}`);
        return match;
      }

      const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
      logger.debug(`Resolved ${fullSpecifier} -> ${resolvedPath}`);
      return `from "${pathToFileURL(resolvedPath).href}"`;
    },
  );

  transformed = transformed.replace(/from\s+["']veryfront["']/g, () => {
    const exportEntry = exportsMap["."];
    if (!exportEntry?.import) return 'from "veryfront"';

    const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
    logger.debug(`Resolved veryfront -> ${resolvedPath}`);
    return `from "${pathToFileURL(resolvedPath).href}"`;
  });

  return transformed;
}

export function rewriteCompiledBinaryVeryfrontImports(code: string): string {
  let transformed = code;

  transformed = transformed.replace(
    /from\s+["']veryfront["']/g,
    'from "./_vf_runtime.mjs"',
  );
  transformed = transformed.replace(
    /import\s*\(\s*["']veryfront["']\s*\)/g,
    'import("./_vf_runtime.mjs")',
  );
  transformed = transformed.replace(
    /from\s+["']veryfront\/([^"']+)["']/g,
    (_match, subpath: string) => `from "./_vf_${subpath.replace(/\//g, "_")}.mjs"`,
  );
  transformed = transformed.replace(
    /import\s*\(\s*["']veryfront\/([^"']+)["']\s*\)/g,
    (_match, subpath: string) => `import("./_vf_${subpath.replace(/\//g, "_")}.mjs")`,
  );

  return transformed;
}

export function rewriteCompiledBinaryUserDependencyImports(
  code: string,
  userDeps: Map<string, string>,
  esmDeps: Map<string, EsmDependencyLocation> = new Map(),
): string {
  let transformed = code;

  for (const name of userDeps.keys()) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // ESM-only dependencies are rewritten to real ES module file:// URLs so that
    // import.meta, top-level await, etc. work. They must NOT be transpiled to
    // CommonJS and evaluated via the `new Function` shim (see __vf_loadCjs).
    const esm = esmDeps.get(name);
    if (esm) {
      // Resolve a subpath import to a contained file:// URL. The subpath comes
      // from the handler source; reject any that escape the package directory
      // (e.g. "pkg/../../secret") by leaving the import untouched so it fails to
      // resolve rather than reading outside node_modules.
      const subpathUrl = (subpath: string, original: string): string | null => {
        const target = pathHelper.resolve(pathHelper.join(esm.packageDir, subpath));
        if (!isWithinDirectory(esm.packageDir, target)) {
          logger.warn(`Skipping ESM subpath import that escapes package directory: ${original}`);
          return null;
        }
        return pathHelper.toFileUrl(target).href;
      };

      transformed = transformed.replace(
        new RegExp(`from\\s+["']${escaped}(/[^"']+)["']`, "g"),
        (match, subpath) => {
          const url = subpathUrl(subpath, match);
          return url ? `from "${url}"` : match;
        },
      );
      transformed = transformed.replace(
        new RegExp(`from\\s+["']${escaped}["']`, "g"),
        () => `from "${esm.entryUrl}"`,
      );
      transformed = transformed.replace(
        new RegExp(`import\\s*\\(\\s*["']${escaped}(/[^"']+)["']\\s*\\)`, "g"),
        (match, subpath) => {
          const url = subpathUrl(subpath, match);
          return url ? `import("${url}")` : match;
        },
      );
      transformed = transformed.replace(
        new RegExp(`import\\s*\\(\\s*["']${escaped}["']\\s*\\)`, "g"),
        () => `import("${esm.entryUrl}")`,
      );
      continue;
    }

    transformed = transformed.replace(
      new RegExp(`import\\s+(\\w+)\\s+from\\s+["']${escaped}["']`, "g"),
      (_, localName) => `const ${localName} = __vf_interopDefault(require("${name}"))`,
    );
    transformed = transformed.replace(
      new RegExp(`import\\s+(\\{[^}]+\\})\\s+from\\s+["']${escaped}["']`, "g"),
      (_, bindings) => `const ${toCjsDestructureBindings(bindings)} = require("${name}")`,
    );
    transformed = transformed.replace(
      new RegExp(`import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+["']${escaped}["']`, "g"),
      (_, localName) => `const ${localName} = require("${name}")`,
    );
    transformed = transformed.replace(
      new RegExp(
        `import\\s+(\\w+)\\s*,\\s*(\\{[^}]+\\})\\s+from\\s+["']${escaped}["']`,
        "g",
      ),
      (_, defaultName, bindings) => {
        const tmp = `__vf_tmp_${defaultName}`;
        return `const ${tmp} = require("${name}"); const ${defaultName} = __vf_interopDefault(${tmp}); const ${
          toCjsDestructureBindings(bindings)
        } = ${tmp}`;
      },
    );
    transformed = transformed.replace(
      new RegExp(
        `import\\s+(\\w+|\\*\\s+as\\s+\\w+|\\{[^}]+\\})\\s+from\\s+["']${escaped}(/[^"']+)["']`,
        "g",
      ),
      (_, binding, subpath) => {
        const trimmedBinding = String(binding).trim();
        if (trimmedBinding.startsWith("{")) {
          return `const ${toCjsDestructureBindings(trimmedBinding)} = require("${name}${subpath}")`;
        }
        const name_ = trimmedBinding.startsWith("*")
          ? trimmedBinding.replace(/\*\s+as\s+/, "")
          : trimmedBinding;
        return `const ${name_} = require("${name}${subpath}")`;
      },
    );
    transformed = transformed.replace(
      new RegExp(`import\\s*\\(\\s*["']${escaped}(/[^"']*)?["']\\s*\\)`, "g"),
      (_, subpath) => `Promise.resolve(require("${name}${subpath || ""}"))`,
    );
  }

  return transformed;
}

export async function rewriteDenoNpmDependencyImports(
  code: string,
  projectDir: string,
  fs: FileSystem,
  userDeps: Map<string, string>,
): Promise<string> {
  let transformed = code;

  for (const [name, version] of userDeps) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let resolvedVersion = version;
    try {
      const pkgPath = pathHelper.join(projectDir, "node_modules", name, "package.json");
      const pkgContent = await fs.readTextFile(pkgPath);
      const pkg = JSON.parse(pkgContent) as { version?: string };
      if (pkg.version) resolvedVersion = pkg.version;
    } catch (_) {
      /* expected: installed package.json may not exist, fall back to declared range */
    }

    transformed = transformed.replace(
      new RegExp(`from\\s+["']${escaped}(/[^"']*)?["']`, "g"),
      (_, subpath) => `from "npm:${name}@${resolvedVersion}${subpath || ""}"`,
    );
    transformed = transformed.replace(
      new RegExp(`import\\s*\\(\\s*["']${escaped}(/[^"']*)?["']\\s*\\)`, "g"),
      (_, subpath) => `import("npm:${name}@${resolvedVersion}${subpath || ""}")`,
    );
  }

  return transformed;
}

export function rewriteDenoNodeBuiltinImports(code: string): string {
  let transformed = code;

  for (const mod of NODE_BUILTINS) {
    const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    transformed = transformed.replace(
      new RegExp(`from\\s+["']${escaped}["']`, "g"),
      `from "node:${mod}"`,
    );
    transformed = transformed.replace(
      new RegExp(`import\\s*\\(\\s*["']${escaped}["']\\s*\\)`, "g"),
      `import("node:${mod}")`,
    );
  }

  return transformed;
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
    transformed = rewriteNpmImports(transformed);
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
