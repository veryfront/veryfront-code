import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { serverLogger } from "#veryfront/utils";
import {
  parseImports,
  parseMaskedImports,
  replaceSpecifiers,
} from "#veryfront/transforms/esm/lexer.ts";
import { resolveContainedPackagePath } from "./package-resolution.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import {
  JS_IDENTIFIER,
  JS_STRING_LITERAL,
  type ModuleSpecifier,
  parseModuleSpecifiers,
  resolveExportEntry as resolveRouteExportEntry,
  toCjsDestructureBindings,
} from "#veryfront/routing/api/module-loader/loader-helpers.ts";
import { rethrowProjectBoundaryViolation } from "#veryfront/routing/api/module-loader/project-source-snapshot.ts";

const logger = serverLogger.component("api");

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
  fs: Pick<FileSystem, "readTextFile">,
): Promise<Map<string, string>> {
  try {
    const content = await fs.readTextFile(pathHelper.join(projectDir, "package.json"));
    const pkg = JSON.parse(content) as { dependencies?: Record<string, string> };
    return new Map(Object.entries(pkg.dependencies ?? {}));
  } catch (error) {
    rethrowProjectBoundaryViolation(error);
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
  fs: Pick<FileSystem, "readTextFile">,
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
    } catch (error) {
      rethrowProjectBoundaryViolation(error);
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

const IMPORT_CLAUSE = new RegExp(
  `^(?:(${JS_IDENTIFIER})\\s*(?:,\\s*)?)?(?:\\*\\s*as\\s+(${JS_IDENTIFIER})|(\\{[^}]*\\}))?$`,
  "u",
);
/** Import attributes (`with { type: "json" }`) and an optional semicolon. */
const STATEMENT_TAIL = `(?:\\s*(?:with|assert)\\s*\\{[^}]*\\})?\\s*;?\\s*$`;
const FROM_SPECIFIER = `from\\s*["'][^"']*["']`;
const STATIC_FROM_IMPORT = new RegExp(
  `^import\\s*([\\s\\S]*?)\\s*${FROM_SPECIFIER}${STATEMENT_TAIL}`,
);
const SIDE_EFFECT_IMPORT = new RegExp(`^import\\s*["'][^"']*["']${STATEMENT_TAIL}`);
const EXPORT_STAR = new RegExp(`^export\\s*\\*\\s*${FROM_SPECIFIER}${STATEMENT_TAIL}`);
const EXPORT_STAR_AS = new RegExp(
  `^export\\s*\\*\\s*as\\s+(${JS_STRING_LITERAL}|${JS_IDENTIFIER})\\s*${FROM_SPECIFIER}${STATEMENT_TAIL}`,
  "u",
);
const EXPORT_NAMED = new RegExp(
  `^export\\s*(\\{[\\s\\S]*\\})\\s*${FROM_SPECIFIER}${STATEMENT_TAIL}`,
);

/** Prefix of the helpers the compiled route rewrite calls; see the prologue. */
export const DEFAULT_ROUTE_HELPER_PREFIX = "__vf_";

/**
 * Rewrite one static import clause to CommonJS bindings over `required`, or
 * return null when the clause is not a form this rewrite understands.
 */
function rewriteCjsImportClause(
  clause: string,
  specifier: string,
  helperPrefix: string,
): string | null {
  const required = `require(${specifier})`;
  const parsed = clause.trim().match(IMPORT_CLAUSE);
  if (!parsed) return null;
  const [, defaultName, namespaceName, named] = parsed;
  if (!defaultName && !namespaceName && !named) return null;

  // `{ default as x }` is the default import under another name, so it takes
  // the same interop as `import x`; the other names destructure.
  const defaultAliases: string[] = [];
  const otherNames: string[] = [];
  if (named) {
    let specifiers: ModuleSpecifier[];
    try {
      specifiers = parseModuleSpecifiers(named);
    } catch (_) {
      // expected: an import clause this rewrite does not understand stays as written
      return null;
    }
    for (const entry of specifiers) {
      if (entry.name === "default" && !entry.nameIsString && entry.alias && !entry.aliasIsString) {
        defaultAliases.push(entry.alias);
      } else {
        otherNames.push(entry.alias === undefined ? entry.name : `${entry.name} as ${entry.alias}`);
      }
    }
  }
  const defaults = defaultName ? [defaultName, ...defaultAliases] : defaultAliases;
  let pattern: string | undefined;
  if (otherNames.length > 0) {
    try {
      pattern = toCjsDestructureBindings(`{ ${otherNames.join(", ")} }`);
    } catch (_) {
      // expected: an import clause this rewrite does not understand stays as written
      return null;
    }
  }

  const bindings = defaults.length + (namespaceName ? 1 : 0) + (pattern ? 1 : 0);
  if (bindings === 0) return required;
  // More than one binding means a default or namespace binding is present.
  const first = defaults[0] ?? namespaceName ?? "";
  const source = bindings > 1 ? `${helperPrefix}tmp_${first}` : required;
  const statements = bindings > 1 ? [`const ${source} = ${required}`] : [];
  for (const name of defaults) {
    statements.push(`const ${name} = ${helperPrefix}interopDefault(${source})`);
  }
  if (namespaceName) {
    statements.push(`const ${namespaceName} = ${helperPrefix}namespace(${specifier})`);
  }
  if (pattern) statements.push(`const ${pattern} = ${source}`);
  return statements.join("; ");
}

const UNSAFE_LITERAL_CHARS: Readonly<Record<string, string>> = {
  "<": "\\u003C",
  ">": "\\u003E",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/** A JavaScript string literal safe to embed anywhere in generated code. */
function toJsStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/[<>\u2028\u2029]/g, (char) => UNSAFE_LITERAL_CHARS[char]!);
}

/** The user dependency a specifier names (`pkg` or `pkg/sub`), longest first. */
function matchUserDependency(
  specifier: string,
  userDeps: Map<string, string>,
): { name: string; subpath: string } | null {
  let best: string | null = null;
  for (const name of userDeps.keys()) {
    if (specifier !== name && !specifier.startsWith(`${name}/`)) continue;
    if (best === null || name.length > best.length) best = name;
  }
  return best === null ? null : { name: best, subpath: specifier.slice(best.length) };
}

/**
 * Rewrite a re-export from a CommonJS dependency into local bindings and a
 * local export list. Names are read once, when the route module loads, as
 * with the import rewrite. `export *` cannot be rewritten: a CommonJS
 * module's names are only known at run time.
 */
function rewriteCjsReexport(
  statement: string,
  specifier: string,
  dependency: string,
  helperPrefix: string,
  index: number,
): string {
  const local = `${helperPrefix}reexport_${index}`;
  const starAs = statement.match(EXPORT_STAR_AS);
  if (starAs) {
    return `const ${local} = ${helperPrefix}namespace(${specifier}); export { ${local} as ${
      starAs[1]
    } }`;
  }
  const named = statement.match(EXPORT_NAMED);
  if (named) {
    const statements = [`const ${local} = require(${specifier})`];
    const exported: string[] = [];
    parseModuleSpecifiers(named[1]!).forEach((entry, position) => {
      const binding = `${local}_${position}`;
      const value = entry.name === "default" && !entry.nameIsString
        ? `${helperPrefix}interopDefault(${local})`
        : entry.nameIsString
        ? `${local}[${entry.name}]`
        : `${local}.${entry.name}`;
      statements.push(`const ${binding} = ${value}`);
      exported.push(`${binding} as ${entry.alias ?? entry.name}`);
    });
    return `${statements.join("; ")}; export { ${exported.join(", ")} }`;
  }
  if (EXPORT_STAR.test(statement)) {
    throw new Error(
      `export * from CommonJS package ${
        JSON.stringify(dependency)
      } is not supported; export its names explicitly`,
    );
  }
  throw new Error(
    `Unsupported re-export from CommonJS package ${JSON.stringify(dependency)}: ${statement}`,
  );
}

/**
 * The index just past the `)` closing a dynamic `import(` whose specifier ends
 * at `from`, skipping an options argument; -1 when it cannot be found.
 */
function findDynamicImportEnd(code: string, from: number): number {
  let depth = 0;
  for (let index = from; index < code.length; index++) {
    const char = code[index]!;
    if (char === '"' || char === "'" || char === "`") {
      for (index++; index < code.length && code[index] !== char; index++) {
        if (code[index] === "\\") index++;
      }
      continue;
    }
    if (char === "/" && code[index + 1] === "/") {
      const end = code.indexOf("\n", index);
      if (end === -1) return -1;
      index = end;
      continue;
    }
    if (char === "/" && code[index + 1] === "*") {
      const end = code.indexOf("*/", index + 2);
      if (end === -1) return -1;
      index = end + 1;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
    else if (char === ")") {
      if (depth === 0) return index + 1;
      depth--;
    }
  }
  return -1;
}

/**
 * Rewrite a bundled compiled-binary route's user dependency imports.
 *
 * Import statements come from the module lexer, so text that only looks like
 * an import (strings, template literals, comments) is never touched. CommonJS
 * dependencies become `require(...)` bindings over the helpers the route
 * prologue declares under `helperPrefix`; ESM-only dependencies keep their
 * import and point at a contained file:// URL.
 */
export async function rewriteCompiledUserDependencyImportsForRoute(
  code: string,
  userDeps: Map<string, string>,
  esmDeps: Map<string, EsmDependencyLocation> = new Map(),
  helperPrefix: string = DEFAULT_ROUTE_HELPER_PREFIX,
): Promise<string> {
  if (userDeps.size === 0) return code;
  const { masked, imports, unmask } = await parseMaskedImports(code);
  const edits: { start: number; end: number; text: string }[] = [];
  let reexports = 0;

  for (const imported of imports) {
    if (typeof imported.n !== "string") continue;
    const dependency = matchUserDependency(imported.n, userDeps);
    if (!dependency) continue;
    const { name, subpath } = dependency;
    const isDynamic = imported.d > -1;

    // ESM-only dependencies are rewritten to real ES module file:// URLs so that
    // import.meta, top-level await, etc. work. They must NOT be transpiled to
    // CommonJS and evaluated via the `new Function` shim (see __vf_loadCjs).
    const esm = esmDeps.get(name);
    if (esm) {
      let url = esm.entryUrl;
      if (subpath) {
        // Reject a subpath that escapes the package directory (e.g.
        // "pkg/../../secret") by leaving the import untouched so it fails to
        // resolve rather than reading outside node_modules.
        const target = resolveContainedPackagePath(esm.packageDir, "." + subpath);
        if (!target) {
          logger.warn(`Skipping ESM subpath import that escapes package directory: ${imported.n}`);
          continue;
        }
        url = pathHelper.toFileUrl(target).href;
      }
      // Static specifier spans exclude the quotes; dynamic ones include them.
      edits.push({
        start: imported.s,
        end: imported.e,
        text: isDynamic ? toJsStringLiteral(url) : url,
      });
      continue;
    }

    const specifier = toJsStringLiteral(name + subpath);
    const required = `require(${specifier})`;
    if (isDynamic) {
      // A dynamic import stays lazy and asynchronous: a load failure rejects
      // the returned promise instead of throwing synchronously. An options
      // argument (import attributes) is consumed: require reads JSON itself.
      const end = findDynamicImportEnd(masked, imported.e);
      if (end === -1) continue;
      edits.push({
        start: imported.ss,
        end,
        text: `Promise.resolve().then(() => ${helperPrefix}namespace(${specifier}))`,
      });
      continue;
    }

    const statement = masked.slice(imported.ss, imported.se);
    if (statement.startsWith("export")) {
      edits.push({
        start: imported.ss,
        end: imported.se,
        text: rewriteCjsReexport(statement, specifier, imported.n, helperPrefix, reexports++),
      });
      continue;
    }
    if (SIDE_EFFECT_IMPORT.test(statement)) {
      edits.push({ start: imported.ss, end: imported.se, text: required });
      continue;
    }
    const clause = statement.match(STATIC_FROM_IMPORT)?.[1];
    const rewritten = clause === undefined
      ? null
      : rewriteCjsImportClause(clause, specifier, helperPrefix);
    if (rewritten !== null) {
      edits.push({ start: imported.ss, end: imported.se, text: rewritten });
    }
  }

  if (edits.length === 0) return code;
  edits.sort((left, right) => right.start - left.start);
  let transformed = masked;
  for (const edit of edits) {
    transformed = transformed.slice(0, edit.start) + edit.text + transformed.slice(edit.end);
  }
  return unmask(transformed);
}

export async function rewriteDenoNpmDependencyImportsForRoute(
  code: string,
  projectDir: string,
  fs: Pick<FileSystem, "readTextFile">,
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
    } catch (error) {
      rethrowProjectBoundaryViolation(error);
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
