/**
 * Import Rewriter
 *
 * Transforms import statements for different runtime environments
 * (Deno, Node.js) and handles veryfront package resolution.
 */

import { isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import {
  parseImports,
  replaceSpecifiers,
  rewriteImports,
} from "#veryfront/transforms/esm/lexer.ts";
import { ensureDefaultBundlerContracts } from "#veryfront/extensions/bundler/defaults.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation/normalization.ts";

export const DISCOVERY_GLOBAL_VERYFRONT_MODULES = [
  "veryfront/agent",
  "veryfront/tool",
  "veryfront/platform",
  "veryfront/prompt",
  "veryfront/resource",
  "veryfront/embedding",
  "veryfront/knowledge",
  "veryfront/workflow",
  "veryfront/eval",
  "veryfront/metrics",
  "veryfront/schemas",
  "veryfront/integrations",
  "veryfront/schedule",
  "veryfront/task",
  "veryfront/trigger",
  "veryfront/webhook",
  // Server-side chat upload route handler (app/api/uploads/route.ts).
  "veryfront/chat/uploads",
] as const;

interface DenoRewriteOptions {
  compiled?: boolean;
  resolveSpecifier?: (specifier: string) => string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toDestructuredBindings(imports: string): string {
  return imports
    .split(",")
    .map((part) => part.trim().replace(/\s+as\s+/g, ": "))
    .filter(Boolean)
    .join(", ");
}

async function rewriteDenoPublicVeryfrontImports(
  code: string,
  resolveSpecifier: (specifier: string) => string,
): Promise<string> {
  return await replaceSpecifiers(code, (specifier) => {
    if (specifier !== "veryfront" && !specifier.startsWith("veryfront/")) return null;
    return resolveSpecifier(specifier);
  });
}

function rewriteDenoCompiledVeryfrontImportStatement(
  code: string,
  nextReexportName: () => string,
): string {
  let transformed = code;

  for (const mod of DISCOVERY_GLOBAL_VERYFRONT_MODULES) {
    const escapedMod = escapeRegExp(mod);
    const moduleExpression = `globalThis.__VERYFRONT_MODULES__["${mod}"]`;

    const wildcardReexportPattern = new RegExp(
      `export\\s*\\*\\s*from\\s*["']${escapedMod}["'];?`,
    );
    if (wildcardReexportPattern.test(transformed)) {
      throw new TypeError(
        `Wildcard re-exports from ${mod} are not supported in compiled discovery modules`,
      );
    }

    const namespaceReexportPattern = new RegExp(
      `export\\s*\\*\\s*as\\s+([A-Za-z_$][\\w$]*)\\s*from\\s*["']${escapedMod}["'];?`,
      "g",
    );
    transformed = transformed.replace(namespaceReexportPattern, (_match, name: string) => {
      return `const ${name} = ${moduleExpression}; export { ${name} };`;
    });

    const namedReexportPattern = new RegExp(
      `export\\s*\\{([^}]+)\\}\\s*from\\s*["']${escapedMod}["'];?`,
      "g",
    );
    transformed = transformed.replace(namedReexportPattern, (_match, exportsList: string) => {
      const bindings: string[] = [];
      const exports: string[] = [];
      for (const part of exportsList.split(",")) {
        const parsed = part.trim().match(
          /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/,
        );
        if (!parsed) {
          throw new TypeError(`Unsupported re-export syntax from ${mod}`);
        }
        const sourceName = parsed[1]!;
        const exportedName = parsed[2] ?? sourceName;
        const localName = nextReexportName();
        bindings.push(`${sourceName}: ${localName}`);
        exports.push(`${localName} as ${exportedName}`);
      }
      return `const { ${bindings.join(", ")} } = ${moduleExpression};\n` +
        `export { ${exports.join(", ")} };`;
    });

    const mixedImportPattern = new RegExp(
      `import\\s+([A-Za-z_$][\\w$]*)\\s*,\\s*\\{([^}]+)\\}\\s*from\\s*["']${escapedMod}["'];?`,
      "g",
    );
    transformed = transformed.replace(
      mixedImportPattern,
      (_match, defaultName: string, imports: string) =>
        `const ${defaultName} = ${moduleExpression}.default;\n` +
        `const { ${toDestructuredBindings(imports)} } = ${moduleExpression};`,
    );

    const importPattern = new RegExp(
      `import\\s*\\{([^}]+)\\}\\s*from\\s*["']${escapedMod}["'];?`,
      "g",
    );
    transformed = transformed.replace(importPattern, (_match, imports: string) => {
      return `const { ${toDestructuredBindings(imports)} } = ${moduleExpression};`;
    });

    const defaultImportPattern = new RegExp(
      `import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*["']${escapedMod}["'];?`,
      "g",
    );
    transformed = transformed.replace(defaultImportPattern, (_match, name: string) => {
      return `const ${name} = ${moduleExpression}.default;`;
    });

    const namespacePattern = new RegExp(
      `import\\s*\\*\\s*as\\s+([A-Za-z_$][\\w$]*)\\s*from\\s*["']${escapedMod}["'];?`,
      "g",
    );
    transformed = transformed.replace(namespacePattern, (_match, name: string) => {
      return `const ${name} = ${moduleExpression};`;
    });

    const dynamicImportPattern = new RegExp(
      `import\\s*\\(\\s*["']${escapedMod}["']\\s*\\)`,
      "g",
    );
    transformed = transformed.replace(
      dynamicImportPattern,
      `Promise.resolve(${moduleExpression})`,
    );

    const sideEffectImportPattern = new RegExp(
      `import\\s*["']${escapedMod}["'];?`,
      "g",
    );
    transformed = transformed.replace(sideEffectImportPattern, `void ${moduleExpression};`);
  }

  return transformed;
}

async function rewriteDenoCompiledVeryfrontImports(code: string): Promise<string> {
  let reexportIndex = 0;
  const generatedNames = new Set<string>();
  const nextReexportName = (): string => {
    while (true) {
      const candidate = `__vf_reexport_${reexportIndex++}`;
      if (generatedNames.has(candidate)) continue;
      if (new RegExp(`\\b${escapeRegExp(candidate)}\\b`).test(code)) continue;
      generatedNames.add(candidate);
      return candidate;
    }
  };

  return await rewriteImports(code, (imp, statement) => {
    if (!imp.n) return null;
    if (imp.d < 0 && TYPE_ONLY_STATIC_RE.test(statement)) return null;
    if (imp.n === "veryfront") {
      throw new TypeError(
        "Root veryfront imports are unavailable in compiled discovery; use an explicit supported subpath",
      );
    }
    if (!imp.n.startsWith("veryfront/")) return null;
    if (
      !DISCOVERY_GLOBAL_VERYFRONT_MODULES.includes(
        imp.n as (typeof DISCOVERY_GLOBAL_VERYFRONT_MODULES)[number],
      )
    ) {
      throw new TypeError("The requested veryfront module is not embedded in compiled discovery");
    }
    return rewriteDenoCompiledVeryfrontImportStatement(statement, nextReexportName);
  });
}

/**
 * True for bare npm imports that need an `npm:` prefix for Deno to resolve
 * them when the discovery module is loaded from a temp directory. Excludes
 * relative paths, absolute URLs, Node built-ins, and the veryfront package
 * (handled by the dedicated rewrites above).
 */
function isUnprefixedNpmSpecifier(specifier: string): boolean {
  if (!specifier) return false;
  if (specifier.startsWith(".") || specifier.startsWith("/")) return false;
  if (specifier.startsWith("#")) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier)) return false;
  if (specifier.startsWith("npm:") || specifier.startsWith("jsr:")) return false;
  if (specifier.startsWith("node:")) return false;
  if (
    specifier.startsWith("file:") ||
    specifier.startsWith("http:") ||
    specifier.startsWith("https:")
  ) return false;
  if (specifier === "veryfront" || specifier.startsWith("veryfront/")) return false;
  return true;
}

// `import type` / `export type` lines reference types only; they get erased
// by TypeScript and must not trigger filesystem resolution.
const TYPE_ONLY_STATIC_RE = /(?:^|[\s;{}])(?:import|export)\s+type\b/;

function replaceImportSpecifierInStatement(
  statement: string,
  specifier: string,
  replacement: string,
): string {
  for (const quote of ['"', "'", "`"]) {
    const token = `${quote}${specifier}${quote}`;
    const index = statement.indexOf(token);
    if (index === -1) continue;
    return statement.slice(0, index) + `${quote}${replacement}${quote}` +
      statement.slice(index + token.length);
  }
  throw new TypeError("Discovery import statement could not be rewritten safely");
}

async function rewriteBareNpmImportsForDeno(code: string): Promise<string> {
  return await rewriteImports(code, (imp, statement) => {
    if (!imp.n || !isUnprefixedNpmSpecifier(imp.n)) return null;
    if (imp.d < 0 && TYPE_ONLY_STATIC_RE.test(statement)) return null;
    return replaceImportSpecifierInStatement(statement, imp.n, `npm:${imp.n}`);
  });
}

/**
 * Rewrite imports for Deno runtime
 * - Converts npm package imports to npm: specifier format
 * - Resolves relative imports to absolute file:// URLs
 * - For compiled binaries, rewrites veryfront imports to use globals
 */
export async function rewriteForDeno(
  code: string,
  fileDir: string,
  options: DenoRewriteOptions = {},
): Promise<string> {
  await ensureDefaultBundlerContracts();
  await inspectDiscoveryImports(code);
  let transformed = code;

  // Handle relative imports
  transformed = await replaceSpecifiers(transformed, (specifier, isDynamic) => {
    if (isDynamic || !specifier.startsWith("../")) return null;
    return pathHelper.toFileUrl(pathHelper.resolve(fileDir, specifier)).href;
  });

  // For compiled binaries, rewrite veryfront imports to use globals
  const compiled = options.compiled ?? isDenoCompiled;
  if (compiled) {
    transformed = await rewriteDenoCompiledVeryfrontImports(transformed);
  } else {
    transformed = await rewriteDenoPublicVeryfrontImports(
      transformed,
      options.resolveSpecifier ?? ((specifier) => import.meta.resolve(specifier)),
    );
  }

  // Prefix any remaining bare npm specifiers with `npm:` so Deno can resolve
  // them from the temp directory the discovery module is loaded from. Covers
  // `zod` plus arbitrary npm packages a tool/agent depends on, after the
  // discovery bundler externalizes them via `packages: "external"`.
  transformed = await rewriteBareNpmImportsForDeno(transformed);

  return transformed;
}

const MAX_PACKAGE_JSON_BYTES = 1 * 1_024 * 1_024;
const MAX_PACKAGE_SPECIFIER_LENGTH = 2_048;
const MAX_PACKAGE_ENTRY_LENGTH = 4_096;
const MAX_NODE_MODULE_SEARCH_DEPTH = 128;
const MAX_DISCOVERY_IMPORT_SPECIFIERS = 2_000;
const MAX_PACKAGE_RESOLUTION_CONCURRENCY = 32;
const MAX_PACKAGE_EXPORT_TRAVERSAL_DEPTH = 64;
const MAX_PACKAGE_EXPORT_TRAVERSAL_NODES = 4_096;
const LEGACY_PACKAGE_EXTENSIONS = [".js", ".mjs", ".cjs", ".json"] as const;
const importRewriterTextEncoder = new TextEncoder();

async function inspectDiscoveryImports(code: string): Promise<Set<string>> {
  const parsedImports = await parseImports(code);
  if (parsedImports.length > MAX_DISCOVERY_IMPORT_SPECIFIERS) {
    throw new RangeError("Discovery module import count exceeds the supported limit");
  }

  const specifiers = new Set<string>();
  for (const imported of parsedImports) {
    if (!imported.n) continue;
    const statement = code.slice(imported.ss, imported.se);
    if (imported.d < 0 && TYPE_ONLY_STATIC_RE.test(statement)) continue;
    if (
      isUnprefixedNpmSpecifier(imported.n) &&
      imported.n.length > MAX_PACKAGE_SPECIFIER_LENGTH
    ) {
      throw new RangeError("Package specifier exceeds the discovery size limit");
    }
    specifiers.add(imported.n);
  }
  return specifiers;
}

// Split `react/jsx-runtime` → { name: "react", subpath: "./jsx-runtime" } and
// `@scope/pkg/sub/path` → { name: "@scope/pkg", subpath: "./sub/path" }.
function splitPackageSubpath(specifier: string): { name: string; subpath: string } {
  if (specifier.length > MAX_PACKAGE_SPECIFIER_LENGTH) {
    throw new RangeError("Package specifier exceeds the discovery size limit");
  }
  const parts = specifier.split("/");
  const segments = specifier.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1);
  const name = segments.join("/");
  const rest = parts.slice(segments.length).join("/");
  return { name, subpath: rest ? `./${rest}` : "." };
}

function isSafePackageEntry(entry: string): boolean {
  return entry.length > 0 && entry.length <= MAX_PACKAGE_ENTRY_LENGTH &&
    !entry.includes("\0") && !entry.includes("\\");
}

function isSafePackageName(name: string): boolean {
  const segments = name.split("/");
  const hasExpectedShape = name.startsWith("@")
    ? segments.length === 2 && segments[0]!.length > 1
    : segments.length === 1;
  return hasExpectedShape &&
    segments.every((segment) =>
      segment.length > 0 && segment !== "." && segment !== ".." &&
      !segment.includes("\0") && !segment.includes("\\")
    );
}

async function resolveLegacyPackageEntry(
  packagePath: string,
  entryPoint: string,
  fs: ReturnType<typeof createFileSystem>,
): Promise<string | null> {
  if (!isSafePackageEntry(entryPoint)) return null;
  const basePath = pathHelper.resolve(packagePath, entryPoint);
  const candidates = [basePath];
  if (!pathHelper.extname(basePath)) {
    for (const extension of LEGACY_PACKAGE_EXTENSIONS) {
      candidates.push(basePath + extension);
    }
  }
  for (const extension of LEGACY_PACKAGE_EXTENSIONS) {
    candidates.push(pathHelper.join(basePath, `index${extension}`));
  }

  for (const candidate of candidates) {
    if (!(await fs.exists(candidate))) continue;
    if ((await fs.stat(candidate)).isFile) return candidate;
  }
  return null;
}

// Pick the relative file path from a `package.json#exports` entry, which can
// be a string, a conditional object (`{ import, default, ... }`), or an
// array of those.
function pickExportEntry(
  entry: unknown,
  depth = 0,
  state: { visited: number } = { visited: 0 },
): string | null {
  state.visited++;
  if (
    depth > MAX_PACKAGE_EXPORT_TRAVERSAL_DEPTH ||
    state.visited > MAX_PACKAGE_EXPORT_TRAVERSAL_NODES
  ) {
    throw new RangeError("Package export traversal exceeds the discovery limit");
  }
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry)) {
    for (const e of entry) {
      const v = pickExportEntry(e, depth + 1, state);
      if (v) return v;
    }
    return null;
  }
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    const candidate = obj.import ?? obj.node ?? obj.default;
    return candidate ? pickExportEntry(candidate, depth + 1, state) : null;
  }
  return null;
}

async function mapWithBoundedConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  transform: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;

  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = nextIndex++;
      if (index >= values.length) return;
      try {
        results[index] = await transform(values[index]!, index);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker(),
    ),
  );
  if (failed) throw failure;
  return results;
}

// Resolve a subpath (`.` or `./foo/bar`) against a `package.json#exports`
// map. Honors literal keys first, then matches `./*`-style glob patterns
// where the trailing `*` is substituted with the captured remainder.
// Returns the resolved relative path (e.g. `./debounce.js`) or null when
// no entry matches.
function resolveExportPath(exports: unknown, subpath: string): string | null {
  if (subpath === "." && (typeof exports === "string" || Array.isArray(exports))) {
    return pickExportEntry(exports);
  }
  if (!exports || typeof exports !== "object") return null;
  const map = exports as Record<string, unknown>;
  const keys = Object.keys(map);

  if (subpath === "." && !keys.some((key) => key.startsWith("."))) {
    return pickExportEntry(exports);
  }

  // Literal key (covers "." and exact subpaths like "./jsx-runtime").
  if (subpath in map) return pickExportEntry(map[subpath]);

  // Glob keys like "./*", "./feature/*", "./lib/*.js". Pick the longest
  // matching prefix so more specific patterns win over `./*`.
  let bestKey: string | null = null;
  let bestPrefixLen = -1;
  for (const key of Object.keys(map)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    if (subpath.length < prefix.length + suffix.length) continue;
    if (prefix.length > bestPrefixLen) {
      bestKey = key;
      bestPrefixLen = prefix.length;
    }
  }
  if (!bestKey) return null;

  const star = bestKey.indexOf("*");
  const captured = subpath.slice(
    bestKey.slice(0, star).length,
    subpath.length - bestKey.slice(star + 1).length,
  );
  const template = pickExportEntry(map[bestKey]);
  if (!template) return null;
  return template.replaceAll("*", captured);
}

/**
 * Rewrite imports for Node.js runtime
 * - Resolves relative imports to file:// URLs
 * - Resolves npm package imports to their node_modules location
 * - Handles veryfront package resolution
 */
export async function rewriteDiscoveryImports(
  code: string,
  projectDir: string,
  fs: ReturnType<typeof createFileSystem>,
  fileDir: string,
): Promise<string> {
  await ensureDefaultBundlerContracts();

  // Resolve a bare specifier (optionally with subpath) to a file URL while
  // honoring package exports. Resolutions are intentionally not cached: a
  // package can be installed or replaced while a development process runs.
  const resolvePackageToFileUrl = async (specifier: string): Promise<string | null> => {
    const { name: packageName, subpath } = splitPackageSubpath(specifier);
    if (!isSafePackageName(packageName)) return null;
    let searchDir = pathHelper.resolve(fileDir || projectDir);

    for (let depth = 0; depth < MAX_NODE_MODULE_SEARCH_DEPTH; depth++) {
      const packagePath = pathHelper.join(searchDir, "node_modules", packageName);
      const packageJsonPath = pathHelper.join(packagePath, "package.json");

      if (await fs.exists(packageJsonPath)) {
        const packageJsonInfo = await fs.stat(packageJsonPath);
        if (
          !Number.isSafeInteger(packageJsonInfo.size) || packageJsonInfo.size < 0 ||
          packageJsonInfo.size > MAX_PACKAGE_JSON_BYTES
        ) {
          throw new RangeError("Package metadata exceeds the discovery size limit");
        }
        const packageJson = await fs.readTextFile(packageJsonPath);
        if (importRewriterTextEncoder.encode(packageJson).byteLength > MAX_PACKAGE_JSON_BYTES) {
          throw new RangeError("Package metadata exceeds the discovery size limit");
        }
        const parsed = JSON.parse(packageJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new TypeError("Package metadata must be a JSON object");
        }
        const pkgJson = parsed as Record<string, unknown>;
        const exportPath = resolveExportPath(pkgJson.exports, subpath);
        if (pkgJson.exports !== undefined && !exportPath) return null;

        if (
          exportPath !== null &&
          (!exportPath.startsWith("./") || !isSafePackageEntry(exportPath))
        ) {
          return null;
        }

        const entryPoint = exportPath ??
          (subpath === "."
            ? (typeof pkgJson.module === "string"
              ? pkgJson.module
              : typeof pkgJson.main === "string"
              ? pkgJson.main
              : "index.js")
            // Packages without an exports map retain legacy subpath access.
            : subpath.replace(/^\.\//, ""));

        if (!isSafePackageEntry(entryPoint)) return null;

        // Defense in depth: refuse resolved paths that escape the package
        // directory. A malicious package shipping `exports: { ".": "../foo" }`
        // would otherwise yield a `file://` URL outside `node_modules/<pkg>`
        // that the discovery loader would still `import()`. `path.resolve`
        // (unlike `path.join`) normalizes `..` segments, so the prefix
        // check correctly catches escape attempts.
        const packagePathPrefix = packagePath.endsWith(pathHelper.SEPARATOR)
          ? packagePath
          : packagePath + pathHelper.SEPARATOR;
        const unresolvedEntry = pathHelper.resolve(packagePath, entryPoint);
        if (unresolvedEntry !== packagePath && !unresolvedEntry.startsWith(packagePathPrefix)) {
          return null;
        }
        const normalized = exportPath
          ? unresolvedEntry
          : await resolveLegacyPackageEntry(packagePath, entryPoint, fs);
        if (!normalized) return null;
        if (exportPath && (!(await fs.exists(normalized)) || !(await fs.stat(normalized)).isFile)) {
          return null;
        }
        if (typeof fs.realPath === "function") {
          const [canonicalPackage, canonicalEntry] = await Promise.all([
            fs.realPath(packagePath),
            fs.realPath(normalized),
          ]);
          if (!isWithinDirectory(canonicalPackage, canonicalEntry)) return null;
        }
        return pathHelper.toFileUrl(normalized).href;
      }

      const parent = pathHelper.dirname(searchDir);
      if (parent === searchDir) break;
      searchDir = parent;

      if (depth === MAX_NODE_MODULE_SEARCH_DEPTH - 1) {
        throw new RangeError("Node module search depth exceeds the discovery limit");
      }
    }

    return null;
  };

  const resolveRuntimeSpecifierToFileUrl = (specifier: string): string | null => {
    try {
      const resolved = import.meta.resolve(specifier);
      return resolved && resolved !== specifier ? resolved : null;
    } catch (_) {
      return null;
    }
  };

  const specifiers = await inspectDiscoveryImports(code);

  const resolvedPairs = await mapWithBoundedConcurrency(
    [...specifiers],
    MAX_PACKAGE_RESOLUTION_CONCURRENCY,
    async (specifier) => {
      if (specifier.startsWith(".")) {
        return [
          specifier,
          pathHelper.toFileUrl(pathHelper.resolve(fileDir, specifier)).href,
        ] as const;
      }
      if (specifier === "veryfront" || specifier.startsWith("veryfront/")) {
        return [
          specifier,
          resolveRuntimeSpecifierToFileUrl(specifier) ??
            await resolvePackageToFileUrl(specifier),
        ] as const;
      }
      if (!isUnprefixedNpmSpecifier(specifier)) return [specifier, null] as const;
      return [specifier, await resolvePackageToFileUrl(specifier)] as const;
    },
  );
  const resolutions = new Map(resolvedPairs);

  return await rewriteImports(code, (imported, statement) => {
    if (!imported.n) return null;
    if (imported.d < 0 && TYPE_ONLY_STATIC_RE.test(statement)) return null;
    const replacement = resolutions.get(imported.n);
    if (!replacement || replacement === imported.n) return null;
    return replaceImportSpecifierInStatement(statement, imported.n, replacement);
  });
}
