import { type FileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { serverLogger } from "#veryfront/utils";
import {
  parseImports,
  replaceSpecifiers,
  rewriteImports,
} from "#veryfront/transforms/esm/lexer.ts";
import {
  pickPackageExportEntry,
  resolveContainedPackagePath,
  resolvePackageExportPath,
  splitPackageSubpath,
} from "./package-resolution.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import { toCjsDestructureBindings } from "./cjs-destructure-bindings.ts";

const logger = serverLogger.component("api");
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const MAX_ROUTE_DEPENDENCIES = 10_000;
const MAX_PACKAGE_NAME_LENGTH = 214;
const MAX_DEPENDENCY_RANGE_LENGTH = 1024;
const packageJsonEncoder = new TextEncoder();

type PackageJsonReader =
  & Pick<FileSystem, "readTextFile">
  & Partial<Pick<FileSystem, "stat">>;

function isSafePackageName(name: unknown): name is string {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > MAX_PACKAGE_NAME_LENGTH ||
    name.includes("\0")
  ) {
    return false;
  }
  const parts = name.startsWith("@") ? name.slice(1).split("/") : name.split("/");
  if (parts.length !== (name.startsWith("@") ? 2 : 1)) return false;
  return parts.every((part) =>
    part.length > 0 &&
    part !== "." &&
    part !== ".." &&
    /^[A-Za-z0-9._~-]+$/.test(part)
  );
}

function isSafeDependencyRange(range: unknown): range is string {
  if (
    typeof range !== "string" ||
    range.length === 0 ||
    range.length > MAX_DEPENDENCY_RANGE_LENGTH
  ) {
    return false;
  }
  for (let index = 0; index < range.length; index++) {
    const char = range[index]!;
    if (
      range.charCodeAt(index) <= 0x1f || char === `"` || char === `'` || char === "\\" ||
      char === "`"
    ) {
      return false;
    }
  }
  return true;
}

function assertSafeUserDependencies(userDeps: Map<string, string>): void {
  if (userDeps.size > MAX_ROUTE_DEPENDENCIES) {
    throw new RangeError(`Route declares more than ${MAX_ROUTE_DEPENDENCIES} dependencies`);
  }
  for (const [name, range] of userDeps) {
    if (!isSafePackageName(name) || !isSafeDependencyRange(range)) {
      const label = typeof name === "string" ? name.slice(0, 120) : "<non-string>";
      throw new TypeError(`Invalid route dependency metadata for "${label}"`);
    }
  }
}

async function readBoundedPackageJson(
  path: string,
  fs: PackageJsonReader,
): Promise<string> {
  if (fs.stat) {
    const stat = await fs.stat(path);
    if (!stat.isFile) throw new TypeError("Package metadata path is not a regular file");
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
      throw new TypeError("Package metadata size is invalid");
    }
    if (stat.size > MAX_PACKAGE_JSON_BYTES) {
      throw new RangeError(`Package metadata exceeds ${MAX_PACKAGE_JSON_BYTES} bytes`);
    }
  }

  const content = await fs.readTextFile(path);
  if (packageJsonEncoder.encode(content).byteLength > MAX_PACKAGE_JSON_BYTES) {
    throw new RangeError(`Package metadata exceeds ${MAX_PACKAGE_JSON_BYTES} bytes`);
  }
  return content;
}

function parsePackageJsonObject(content: string): Record<string, unknown> {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Package metadata must be a JSON object");
  }
  return value as Record<string, unknown>;
}

async function readOptionalPackageJsonForRoute(
  packageJsonPath: string,
  fs: PackageJsonReader,
): Promise<Record<string, unknown> | null> {
  let content: string;
  try {
    content = await readBoundedPackageJson(packageJsonPath, fs);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  return parsePackageJsonObject(content);
}

export async function resolveNodePackageToFileUrlForRoute(
  projectDir: string,
  packageName: string,
  fs: FileSystem,
  pathToFileUrl: (path: string) => URL,
): Promise<string | null> {
  if (!isSafePackageName(packageName)) {
    throw new TypeError("Invalid route dependency name");
  }

  const packagePath = pathHelper.resolve(
    pathHelper.join(projectDir, "node_modules", packageName),
  );
  const packageJson = await readOptionalPackageJsonForRoute(
    pathHelper.join(packagePath, "package.json"),
    fs,
  );
  if (!packageJson) return null;

  const entryPoint = resolveEsmEntry(packageJson);
  if (!entryPoint || entryPoint.length > 4096 || entryPoint.includes("\0")) {
    throw new TypeError(`Installed dependency "${packageName}" has an invalid entry path`);
  }
  const resolvedPath = pathHelper.resolve(pathHelper.join(packagePath, entryPoint));
  if (!isWithinDirectory(packagePath, resolvedPath)) {
    throw new TypeError(`Installed dependency "${packageName}" has an escaping entry path`);
  }
  return pathToFileUrl(resolvedPath).href;
}

export interface VeryfrontExportLocation {
  import?: string;
}

export async function loadVeryfrontExportsMapForRoute(
  projectDir: string,
  fs: FileSystem,
): Promise<Record<string, VeryfrontExportLocation>> {
  const packagePath = pathHelper.resolve(
    pathHelper.join(projectDir, "node_modules", "veryfront"),
  );
  const packageJson = await readOptionalPackageJsonForRoute(
    pathHelper.join(packagePath, "package.json"),
    fs,
  );
  if (!packageJson || packageJson.exports === undefined) return {};
  if (
    !packageJson.exports ||
    typeof packageJson.exports !== "object" ||
    Array.isArray(packageJson.exports)
  ) {
    throw new TypeError("Installed veryfront package exports must be an object");
  }

  const result: Record<string, VeryfrontExportLocation> = {};
  for (const [subpath, rawLocation] of Object.entries(packageJson.exports)) {
    if (
      (subpath !== "." && !subpath.startsWith("./")) ||
      subpath.length > 4096 ||
      subpath.includes("\0")
    ) {
      throw new TypeError(`Installed veryfront package has an invalid export key`);
    }
    const importPath = pickPackageExportEntry(rawLocation) ?? undefined;
    if (
      importPath === undefined &&
      rawLocation &&
      (typeof rawLocation === "object" || Array.isArray(rawLocation))
    ) {
      result[subpath] = {};
      continue;
    }
    if (
      typeof importPath !== "string" ||
      importPath.length === 0 ||
      importPath.length > 4096 ||
      importPath.includes("\0") ||
      !importPath.startsWith("./")
    ) {
      throw new TypeError(`Installed veryfront export "${subpath}" has an invalid import path`);
    }
    const resolvedPath = pathHelper.resolve(pathHelper.join(packagePath, importPath));
    if (!isWithinDirectory(packagePath, resolvedPath)) {
      throw new TypeError(`Installed veryfront export "${subpath}" escapes its package`);
    }
    result[subpath] = { import: importPath };
  }
  return result;
}

/**
 * Bare builtins supported by Deno's Node compatibility layer.
 *
 * This intentionally stays separate from the Node-runtime list used by MDX:
 * Deno does not implement every `node:` module exposed by current Node.
 */
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

export async function readProjectDependenciesForRoute(
  projectDir: string,
  fs: PackageJsonReader,
): Promise<Map<string, string>> {
  const pkg = await readOptionalPackageJsonForRoute(
    pathHelper.join(projectDir, "package.json"),
    fs,
  );
  if (!pkg) return new Map();
  const dependencies = pkg.dependencies;
  if (dependencies === undefined) return new Map();
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    throw new TypeError("Project package.json dependencies must be an object");
  }

  const entries = Object.entries(dependencies);
  if (
    entries.length > MAX_ROUTE_DEPENDENCIES ||
    entries.some(([, range]) => typeof range !== "string")
  ) {
    throw new TypeError("Project package.json dependencies are invalid");
  }
  const result = new Map(entries as Array<[string, string]>);
  assertSafeUserDependencies(result);
  return result;
}

export function getNodeExternalPackagesToResolveForRoute(userDeps: Map<string, string>): string[] {
  assertSafeUserDependencies(userDeps);
  const externalPackagesToResolve = ["zod"];

  for (const name of userDeps.keys()) {
    if (!externalPackagesToResolve.includes(name)) {
      externalPackagesToResolve.push(name);
    }
  }

  return externalPackagesToResolve;
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
  const fromExports = resolvePackageExportPath(pkgJson.exports, ".");
  if (fromExports) return fromExports;

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
export async function resolveEsmUserDependenciesForRoute(
  projectDir: string,
  fs: FileSystem,
  userDeps: Map<string, string>,
): Promise<Map<string, EsmDependencyLocation>> {
  assertSafeUserDependencies(userDeps);
  const esmDeps = new Map<string, EsmDependencyLocation>();

  for (const name of userDeps.keys()) {
    const packageDir = pathHelper.resolve(pathHelper.join(projectDir, "node_modules", name));
    const pkgJson = await readOptionalPackageJsonForRoute(
      pathHelper.join(packageDir, "package.json"),
      fs,
    );
    if (!pkgJson) continue;
    const entry = resolveEsmEntry(pkgJson);
    if (!entry || !isEsmPackage(pkgJson, entry)) continue;
    if (entry.length > 4096 || entry.includes("\0")) {
      throw new TypeError(`Installed dependency "${name}" has an invalid entry path`);
    }

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
  }

  return esmDeps;
}

export function rewriteCompiledVeryfrontImportsForRoute(code: string): string {
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

/**
 * Lexer-scoped Veryfront shim rewrite used by production route loading.
 *
 * The synchronous compatibility helper above predates the module lexer and can
 * match import-looking text inside strings. Keep its public behavior stable,
 * but never run it over an entire production module.
 */
export function rewriteCompiledVeryfrontImportsForRouteAsync(
  code: string,
): Promise<string> {
  return replaceSpecifiers(code, (specifier) => {
    if (specifier === "veryfront") return "./_vf_runtime.mjs";
    if (!specifier.startsWith("veryfront/")) return undefined;
    const subpath = specifier.slice("veryfront/".length);
    return `./_vf_${subpath.replace(/\//g, "_")}.mjs`;
  });
}

export function rewriteCompiledUserDependencyImportsForRoute(
  code: string,
  userDeps: Map<string, string>,
  esmDeps: Map<string, EsmDependencyLocation> = new Map(),
): string {
  assertSafeUserDependencies(userDeps);
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
        const target = resolveContainedPackagePath(esm.packageDir, "." + subpath);
        if (!target) {
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
      transformed = transformed.replace(
        new RegExp(`import\\s+["']${escaped}(/[^"']*)?["']`, "g"),
        (match, subpath) => {
          const url = subpath ? subpathUrl(subpath, match) : esm.entryUrl;
          return url ? `import "${url}"` : match;
        },
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
    transformed = transformed.replace(
      new RegExp(`import\\s+["']${escaped}(/[^"']*)?["']`, "g"),
      (_, subpath) => `require("${name}${subpath || ""}")`,
    );
  }

  return transformed;
}

/**
 * Restrict legacy CJS statement rewrites to ranges identified by the module
 * lexer. This preserves the compiled-binary conversion without allowing its
 * regular expressions to modify comments, strings, or template contents.
 */
export async function rewriteCompiledUserDependencyImportsForRouteAsync(
  code: string,
  userDeps: Map<string, string>,
  esmDeps: Map<string, EsmDependencyLocation> = new Map(),
): Promise<string> {
  assertSafeUserDependencies(userDeps);

  return await rewriteImports(code, (specifier, statement) => {
    if (!specifier.n) return null;
    const { name } = splitPackageSubpath(specifier.n);
    const version = userDeps.get(name);
    if (version === undefined) return null;

    const selectedDependencies = new Map([[name, version]]);
    const selectedEsmDependencies = esmDeps.has(name)
      ? new Map([[name, esmDeps.get(name)!]])
      : new Map<string, EsmDependencyLocation>();
    const rewritten = rewriteCompiledUserDependencyImportsForRoute(
      statement,
      selectedDependencies,
      selectedEsmDependencies,
    );
    if (rewritten === statement && /^\s*export\b/.test(statement)) {
      throw new TypeError(
        `Compiled route cannot re-export CommonJS dependency "${specifier.n}"; import it and export an explicit route handler instead`,
      );
    }
    return rewritten === statement ? null : rewritten;
  });
}

export async function rewriteDenoNpmDependencyImportsForRoute(
  code: string,
  projectDir: string,
  fs: FileSystem,
  userDeps: Map<string, string>,
  options: { requireInstalledExactVersions?: boolean } = {},
): Promise<string> {
  assertSafeUserDependencies(userDeps);
  const importedSpecifiers = new Set(
    (await parseImports(code))
      .map((imp) => imp.n)
      .filter((specifier): specifier is string => typeof specifier === "string"),
  );
  const replacements = new Map<string, string>();

  for (const specifier of importedSpecifiers) {
    const entry = [...userDeps].find(([name]) =>
      specifier === name || specifier.startsWith(`${name}/`)
    );
    if (!entry) continue;

    const [name, version] = entry;
    let resolvedVersion = version;
    let installedVersion: unknown;
    const pkgPath = pathHelper.join(projectDir, "node_modules", name, "package.json");
    const packageJson = await readOptionalPackageJsonForRoute(pkgPath, fs);
    if (!packageJson) {
      if (options.requireInstalledExactVersions) {
        throw new TypeError(
          `Prepared API route dependency "${name}" must be installed before worker execution`,
        );
      }
      /* expected: installed package.json may not exist, fall back to declared range */
    } else {
      installedVersion = packageJson.version;
    }
    if (options.requireInstalledExactVersions) {
      if (typeof installedVersion !== "string" || !isExactNpmVersion(installedVersion)) {
        throw new TypeError(
          `Prepared API route dependency "${name}" does not expose an exact installed version`,
        );
      }
      resolvedVersion = installedVersion;
    } else if (typeof installedVersion === "string" && isExactNpmVersion(installedVersion)) {
      resolvedVersion = installedVersion;
    }

    const subpath = specifier.slice(name.length);
    replacements.set(specifier, `npm:${name}@${resolvedVersion}${subpath}`);
  }

  if (replacements.size === 0) return code;

  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier));
}

const EXACT_NPM_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function isExactNpmVersion(version: string): boolean {
  return EXACT_NPM_VERSION_PATTERN.test(version);
}

function isExactNpmSpecifier(specifier: string): boolean {
  const match = /^npm:(?:@[^/@]+\/[^/@]+|[^@/]+)@([^/]+)(?:\/.*)?$/.exec(specifier);
  return match !== null && isExactNpmVersion(match[1]!);
}

/**
 * Validate the import surface of a host-prepared worker module.
 *
 * Data-URL modules have no project-relative referrer. Installed dependencies
 * must already use exact npm specifiers, framework imports are not available
 * until the worker owns their graph, and file imports must remain in-project.
 */
export async function finalizePreparedWorkerImportsForRoute(
  code: string,
  projectDir: string,
): Promise<string> {
  const importedSpecifiers = new Set(
    (await parseImports(code))
      .map((specifier) => specifier.n)
      .filter((specifier): specifier is string => typeof specifier === "string"),
  );

  for (const specifier of importedSpecifiers) {
    if (specifier === "veryfront" || specifier.startsWith("veryfront/")) {
      throw new TypeError(
        `Prepared API route framework import "${specifier}" is unavailable until framework modules are snapshot-owned by the worker`,
      );
    }

    if (specifier.startsWith("node:")) {
      continue;
    }
    if (specifier.startsWith("file:")) {
      let importedPath: string;
      try {
        importedPath = pathHelper.fromFileUrl(specifier);
      } catch {
        throw new TypeError(
          `Prepared API route contains an invalid file import: ${specifier}`,
        );
      }
      if (!isWithinDirectory(pathHelper.resolve(projectDir), pathHelper.resolve(importedPath))) {
        throw new TypeError(
          `Prepared API route file import escapes the project directory: ${specifier}`,
        );
      }
      continue;
    }
    if (specifier.startsWith("npm:")) {
      if (isExactNpmSpecifier(specifier)) continue;
      throw new TypeError(
        `Prepared API route npm import must use an exact installed version: ${specifier}`,
      );
    }

    throw new TypeError(
      `Prepared API route contains an unsupported unresolved import: ${specifier}`,
    );
  }

  return code;
}

export function rewriteDenoNodeBuiltinsForRoute(code: string): string {
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

/** Lexer-scoped Node built-in rewrite used by production route loading. */
export function rewriteDenoNodeBuiltinsForRouteAsync(code: string): Promise<string> {
  const builtins: ReadonlySet<string> = new Set(NODE_BUILTINS);
  return replaceSpecifiers(
    code,
    (specifier) => builtins.has(specifier) ? `node:${specifier}` : undefined,
  );
}
