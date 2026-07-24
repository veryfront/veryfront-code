import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { serverLogger } from "#veryfront/utils";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import { resolveContainedPackagePath } from "./package-resolution.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import {
  resolveExportEntry as resolveRouteExportEntry,
  toCjsDestructureBindings,
} from "#veryfront/routing/api/module-loader/loader-helpers.ts";

const logger = serverLogger.component("api");

/** Node.js built-in module names, shared across route-loader external rewrites. */
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

export function getNodeExternalPackagesToResolveForRoute(userDeps: Map<string, string>): string[] {
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
  const exportsField = pkgJson.exports;
  if (exportsField && typeof exportsField === "object") {
    const dot = (exportsField as Record<string, unknown>)["."];
    const fromExports = resolveRouteExportEntry(dot ?? exportsField);
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
export async function resolveEsmUserDependenciesForRoute(
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
      /* expected: package.json missing/invalid -> treat as CJS */
    }
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

export function rewriteCompiledUserDependencyImportsForRoute(
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

export async function rewriteDenoNpmDependencyImportsForRoute(
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
    const entry = [...userDeps].find(([name]) =>
      specifier === name || specifier.startsWith(`${name}/`)
    );
    if (!entry) continue;

    const [name, version] = entry;
    let resolvedVersion = version;
    try {
      const pkgPath = pathHelper.join(projectDir, "node_modules", name, "package.json");
      const pkgContent = await fs.readTextFile(pkgPath);
      const pkg = JSON.parse(pkgContent) as { version?: string };
      if (pkg.version) resolvedVersion = pkg.version;
    } catch (_) {
      /* expected: installed package.json may not exist, fall back to declared range */
    }

    const subpath = specifier.slice(name.length);
    replacements.set(specifier, `npm:${name}@${resolvedVersion}${subpath}`);
  }

  if (replacements.size === 0) return code;

  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier));
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
