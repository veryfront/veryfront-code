import { isCompiledBinary, serverLogger } from "#veryfront/utils";
import { type FileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { rewriteNpmImports } from "#veryfront/transforms/npm-import-rewrites.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import { resolveExportEntry, toCjsDestructureBindings } from "./loader-helpers.ts";
import { parseBarePackageSpecifier } from "#veryfront/transforms/shared/package-specifier.ts";
import { rewriteModuleSpecifiers } from "#veryfront/modules/loader-shared/import-specifiers.ts";

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
  let content: string;
  try {
    content = await fs.readTextFile(pathHelper.join(projectDir, "package.json"));
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    return new Map();
  }

  const pkg = JSON.parse(content) as { dependencies?: unknown };
  if (pkg.dependencies === undefined) return new Map();
  if (
    !pkg.dependencies || typeof pkg.dependencies !== "object" || Array.isArray(pkg.dependencies)
  ) {
    throw new TypeError("package.json dependencies must be an object");
  }

  const dependencies = new Map<string, string>();
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    const parsed = parseBarePackageSpecifier(name);
    if (
      !parsed || parsed.packageName !== name || parsed.subpath !== null || parsed.version !== null
    ) {
      throw new TypeError(`Invalid dependency package name: ${name}`);
    }
    if (typeof version !== "string" || version.length === 0) {
      throw new TypeError(`Dependency version for ${name} must be a non-empty string`);
    }
    dependencies.set(name, version);
  }
  return dependencies;
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

  let packageJson: string;
  try {
    packageJson = await fs.readTextFile(packageJsonPath);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  const pkgJson = JSON.parse(packageJson) as Record<string, unknown>;
  let entryPoint = pkgJson.exports && typeof pkgJson.exports === "object"
    ? resolveExportEntry((pkgJson.exports as Record<string, unknown>)["."])
    : undefined;
  entryPoint ||= typeof pkgJson.module === "string"
    ? pkgJson.module
    : typeof pkgJson.main === "string"
    ? pkgJson.main
    : "index.js";

  const resolvedEntry = pathHelper.resolve(pathHelper.join(packagePath, entryPoint));
  if (!isWithinDirectory(pathHelper.resolve(packagePath), resolvedEntry)) return null;
  return pathToFileURL(resolvedEntry).href;
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
    let packageJson: string;
    try {
      packageJson = await fs.readTextFile(pathHelper.join(packageDir, "package.json"));
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
    const pkgJson = JSON.parse(packageJson) as Record<string, unknown>;

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
      logger.warn(`Skipping ESM dependency ${name}: entry escapes package directory`);
      continue;
    }

    esmDeps.set(name, {
      entryUrl: pathHelper.toFileUrl(entryPath).href,
      packageDir,
    });
  }

  return esmDeps;
}

export async function loadVeryfrontExportsMap(
  projectDir: string,
  fs: FileSystem,
): Promise<Record<string, { import?: string }>> {
  const vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
  const vfPackageJsonPath = pathHelper.join(vfPackagePath, "package.json");

  let packageJson: string;
  try {
    packageJson = await fs.readTextFile(vfPackageJsonPath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    logger.debug("Could not read veryfront package.json");
    return {};
  }
  const pkgJson = JSON.parse(packageJson) as { exports?: unknown };
  if (pkgJson.exports === undefined) return {};
  if (!pkgJson.exports || typeof pkgJson.exports !== "object" || Array.isArray(pkgJson.exports)) {
    throw new TypeError("veryfront package exports must be an object");
  }
  return pkgJson.exports as Record<string, { import?: string }>;
}

export async function rewriteNodeExternalImports(
  code: string,
  projectDir: string,
  fs: FileSystem,
  userDeps: Map<string, string>,
): Promise<string> {
  const { pathToFileURL } = await import("node:url");
  const replacements = new Map<string, string>();

  logger.debug("Rewriting external API imports for Node.js");

  const importedSpecifiers = new Set(
    (await parseImports(code))
      .map((imp) => imp.n)
      .filter((specifier): specifier is string => typeof specifier === "string"),
  );
  const packages = getNodeExternalPackagesToResolve(userDeps);

  for (const specifier of importedSpecifiers) {
    const parsed = parseBarePackageSpecifier(specifier);
    const pkg = parsed && packages.includes(parsed.packageName) ? parsed.packageName : undefined;
    if (!pkg) continue;

    const subpath = parsed?.subpath;
    if (subpath) {
      const packageDir = pathHelper.resolve(pathHelper.join(projectDir, "node_modules", pkg));
      const resolvedSubpath = pathHelper.resolve(pathHelper.join(packageDir, subpath));
      if (!isWithinDirectory(packageDir, resolvedSubpath)) continue;
      replacements.set(specifier, pathToFileURL(resolvedSubpath).href);
      continue;
    }

    const resolvedUrl = await resolveNodePackageToFileUrl(projectDir, pkg, fs, pathToFileURL);
    if (!resolvedUrl) continue;
    replacements.set(specifier, resolvedUrl);
  }

  const vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
  const exportsMap = await loadVeryfrontExportsMap(projectDir, fs);

  for (const specifier of importedSpecifiers) {
    if (specifier === "veryfront") {
      const exportEntry = exportsMap["."];
      if (!exportEntry?.import) continue;

      const resolvedPath = pathHelper.join(vfPackagePath, exportEntry.import);
      if (!isWithinDirectory(pathHelper.resolve(vfPackagePath), pathHelper.resolve(resolvedPath))) {
        throw new Error("Veryfront package export escapes its package directory");
      }
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
      if (!isWithinDirectory(pathHelper.resolve(vfPackagePath), pathHelper.resolve(resolvedPath))) {
        throw new Error("Veryfront package export escapes its package directory");
      }
      replacements.set(specifier, pathToFileURL(resolvedPath).href);
    }
  }

  if (replacements.size === 0) return code;

  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier));
}

export function encodeVeryfrontSubpath(subpath: string): string {
  return Array.from(new TextEncoder().encode(subpath), (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function decodeVeryfrontSubpath(encoded: string): string {
  if (!/^(?:[0-9a-f]{2})+$/.test(encoded)) throw new Error("Invalid Veryfront shim name");
  const bytes = new Uint8Array(encoded.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(encoded.slice(index * 2, index * 2 + 2), 16);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function rewriteCompiledBinaryVeryfrontImports(code: string): string {
  return rewriteModuleSpecifiers(code, (specifier) => {
    if (specifier === "veryfront") return "./_vf_runtime.mjs";
    if (!specifier.startsWith("veryfront/") || specifier.length === "veryfront/".length) {
      return undefined;
    }
    return `./_vf_${encodeVeryfrontSubpath(specifier.slice("veryfront/".length))}.mjs`;
  });
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
  const importedSpecifiers = new Set(
    (await parseImports(code))
      .map((imp) => imp.n)
      .filter((specifier): specifier is string => typeof specifier === "string"),
  );
  const replacements = new Map<string, string>();

  for (const specifier of importedSpecifiers) {
    const parsed = parseBarePackageSpecifier(specifier);
    if (!parsed) continue;
    const declaredVersion = userDeps.get(parsed.packageName);
    if (declaredVersion === undefined) continue;

    const name = parsed.packageName;
    let resolvedVersion = declaredVersion;
    try {
      const pkgPath = pathHelper.join(projectDir, "node_modules", name, "package.json");
      const pkgContent = await fs.readTextFile(pkgPath);
      const pkg = JSON.parse(pkgContent) as { version?: string };
      if (typeof pkg.version === "string" && pkg.version.length > 0) resolvedVersion = pkg.version;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      /* expected: installed package.json may not exist, use the declared range */
    }

    const subpath = parsed.subpath ?? "";
    replacements.set(specifier, `npm:${name}@${resolvedVersion}${subpath}`);
  }

  if (replacements.size === 0) return code;

  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier));
}

export function rewriteDenoNodeBuiltinImports(code: string): string {
  const builtins = new Set<string>(NODE_BUILTINS);
  return rewriteModuleSpecifiers(
    code,
    (specifier) => builtins.has(specifier) ? `node:${specifier}` : undefined,
  );
}

export async function rewriteExternalImports(
  code: string,
  projectDir: string,
  fs: FileSystem,
  userDeps: Map<string, string> = new Map(),
  options: { preserveVeryfrontImports?: boolean } = {},
): Promise<string> {
  let transformed = code;

  if (isNode) {
    transformed = await rewriteNodeExternalImports(transformed, projectDir, fs, userDeps);
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
    if (isCompiledBinary() && !options.preserveVeryfrontImports) {
      transformed = rewriteCompiledBinaryVeryfrontImports(transformed);
    }
  }

  return transformed;
}
