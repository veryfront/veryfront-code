/**
 * Import Rewriter
 *
 * Transforms import statements for different runtime environments
 * (Deno, Node.js) and handles veryfront package resolution.
 */

import { isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";

export const DISCOVERY_GLOBAL_VERYFRONT_MODULES = [
  "veryfront/agent",
  "veryfront/tool",
  "veryfront/platform",
  "veryfront/prompt",
  "veryfront/resource",
  "veryfront/embedding",
  "veryfront/workflow",
  "veryfront/schemas",
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

function rewriteDenoPublicVeryfrontImports(
  code: string,
  resolveSpecifier: (specifier: string) => string,
): string {
  const resolve = (specifier: string): string | null => {
    try {
      return resolveSpecifier(specifier);
    } catch (_) {
      return null;
    }
  };

  return code
    .replace(/from\s+["'](veryfront(?:\/[^"']+)?)["']/g, (match, specifier: string) => {
      const resolved = resolve(specifier);
      return resolved ? `from "${resolved}"` : match;
    })
    .replace(/import\s*\(\s*["'](veryfront(?:\/[^"']+)?)["']\s*\)/g, (match, specifier: string) => {
      const resolved = resolve(specifier);
      return resolved ? `import("${resolved}")` : match;
    });
}

function rewriteDenoCompiledVeryfrontImports(code: string): string {
  let transformed = code;

  for (const mod of DISCOVERY_GLOBAL_VERYFRONT_MODULES) {
    const escapedMod = escapeRegExp(mod);

    const importPattern = new RegExp(
      `import\\s*\\{([^}]+)\\}\\s*from\\s*["']${escapedMod}["'];?`,
      "g",
    );
    transformed = transformed.replace(importPattern, (_match, imports: string) => {
      return `const { ${
        toDestructuredBindings(imports)
      } } = globalThis.__VERYFRONT_MODULES__["${mod}"];`;
    });

    const namespacePattern = new RegExp(
      `import\\s*\\*\\s*as\\s+(\\w+)\\s*from\\s*["']${escapedMod}["'];?`,
      "g",
    );
    transformed = transformed.replace(namespacePattern, (_match, name: string) => {
      return `const ${name} = globalThis.__VERYFRONT_MODULES__["${mod}"];`;
    });
  }

  return transformed;
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

function rewriteBareNpmImportsForDeno(code: string): string {
  return code
    // `import x from "spec"`, `export { x } from "spec"`, `export * from "spec"`.
    // The leading-context capture lets us skip `import type` / `export type`.
    .replace(
      /(^|[\s;{}])((?:import|export)\b[^"']*?\bfrom\s+)["']([^"']+)["']/g,
      (match, lead: string, head: string, specifier: string) => {
        if (TYPE_ONLY_STATIC_RE.test(lead + head)) return match;
        return isUnprefixedNpmSpecifier(specifier) ? `${lead}${head}"npm:${specifier}"` : match;
      },
    )
    .replace(/import\s*\(\s*["']([^"']+)["']\s*\)/g, (match, specifier: string) => {
      return isUnprefixedNpmSpecifier(specifier) ? `import("npm:${specifier}")` : match;
    })
    // Side-effect-only imports: `import "reflect-metadata";`, `import "dotenv/config";`.
    .replace(
      /(^|[\n;{}])(\s*)import\s+["']([^"']+)["'](\s*;?)/g,
      (match, lead: string, indent: string, specifier: string, tail: string) => {
        return isUnprefixedNpmSpecifier(specifier)
          ? `${lead}${indent}import "npm:${specifier}"${tail}`
          : match;
      },
    );
}

/**
 * Rewrite imports for Deno runtime
 * - Converts npm package imports to npm: specifier format
 * - Resolves relative imports to absolute file:// URLs
 * - For compiled binaries, rewrites veryfront imports to use globals
 */
export function rewriteForDeno(
  code: string,
  fileDir: string,
  options: DenoRewriteOptions = {},
): string {
  let transformed = code;

  // Handle relative imports
  transformed = transformed.replace(
    /from\s+["'](\.\.\/[^"']+)["']/g,
    (_match, relativePath: string) => `from "file://${pathHelper.resolve(fileDir, relativePath)}"`,
  );

  // For compiled binaries, rewrite veryfront imports to use globals
  const compiled = options.compiled ?? isDenoCompiled;
  if (compiled) {
    transformed = rewriteDenoCompiledVeryfrontImports(transformed);
  } else {
    transformed = rewriteDenoPublicVeryfrontImports(
      transformed,
      options.resolveSpecifier ?? ((specifier) => import.meta.resolve(specifier)),
    );
  }

  // Prefix any remaining bare npm specifiers with `npm:` so Deno can resolve
  // them from the temp directory the discovery module is loaded from. Covers
  // `zod` plus arbitrary npm packages a tool/agent depends on, after the
  // discovery bundler externalizes them via `packages: "external"`.
  transformed = rewriteBareNpmImportsForDeno(transformed);

  return transformed;
}

// Memoizes resolved bare-specifier → file:// URL lookups across all
// `rewriteDiscoveryImports` calls. Keyed by `${projectDir}::${specifier}`.
// Most projects re-resolve the same handful of packages (react, zod,
// pdf-parse, …) across every discovered tool/agent file — without this
// cache, each discovery pass re-reads the same package.json files.
const resolvedSpecifierCache = new Map<string, string | null>();

// Split `react/jsx-runtime` → { name: "react", subpath: "./jsx-runtime" } and
// `@scope/pkg/sub/path` → { name: "@scope/pkg", subpath: "./sub/path" }.
function splitPackageSubpath(specifier: string): { name: string; subpath: string } {
  const parts = specifier.split("/");
  const segments = specifier.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1);
  const name = segments.join("/");
  const rest = parts.slice(segments.length).join("/");
  return { name, subpath: rest ? `./${rest}` : "." };
}

// Pick the relative file path from a `package.json#exports` entry, which can
// be a string, a conditional object (`{ import, default, ... }`), or an
// array of those.
function pickExportEntry(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry)) {
    for (const e of entry) {
      const v = pickExportEntry(e);
      if (v) return v;
    }
    return null;
  }
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    const candidate = obj.import ?? obj.node ?? obj.default;
    return candidate ? pickExportEntry(candidate) : null;
  }
  return null;
}

// Resolve a subpath (`.` or `./foo/bar`) against a `package.json#exports`
// map. Honors literal keys first, then matches `./*`-style glob patterns
// where the trailing `*` is substituted with the captured remainder.
// Returns the resolved relative path (e.g. `./debounce.js`) or null when
// no entry matches.
function resolveExportPath(exports: unknown, subpath: string): string | null {
  if (!exports || typeof exports !== "object") return null;
  const map = exports as Record<string, unknown>;

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
  return template.replace("*", captured);
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
  let transformed = code;

  try {
    const { pathToFileURL } = await import("node:url");

    // Handle relative imports
    transformed = transformed.replace(
      /from\s+["'](\.\.\/[^"']+)["']/g,
      (_match, relativePath: string) =>
        `from "${pathToFileURL(pathHelper.resolve(fileDir, relativePath)).href}"`,
    );

    // Resolve a bare specifier (optionally with subpath) to a file:// URL,
    // honoring the package's `exports` map for subpath imports such as
    // `react/jsx-runtime` or `lodash-es/debounce`. Successful resolutions
    // are memoized per (projectDir, specifier); failures are NOT cached
    // so a subsequent `npm install` of the missing dep is picked up
    // without a process restart.
    const resolvePackageToFileUrl = async (specifier: string): Promise<string | null> => {
      const cacheKey = `${projectDir}::${specifier}`;
      const cached = resolvedSpecifierCache.get(cacheKey);
      if (cached !== undefined) return cached;

      const { name: packageName, subpath } = splitPackageSubpath(specifier);
      let searchDir = projectDir;

      for (let i = 0; i < 10; i++) {
        const packagePath = pathHelper.join(searchDir, "node_modules", packageName);
        const packageJsonPath = pathHelper.join(packagePath, "package.json");

        try {
          const pkgJson = JSON.parse(await fs.readTextFile(packageJsonPath));
          const exportPath = resolveExportPath(pkgJson.exports, subpath);

          const entryPoint = exportPath ??
            (subpath === "."
              ? (pkgJson.module ?? pkgJson.main ?? "index.js")
              // No exports entry matched: fall back to joining the subpath
              // onto the package dir (e.g. `dotenv/config.js`).
              : subpath.replace(/^\.\//, ""));

          // Defense in depth: refuse resolved paths that escape the package
          // directory. A malicious package shipping `exports: { ".": "../foo" }`
          // would otherwise yield a `file://` URL outside `node_modules/<pkg>`
          // that the discovery loader would still `import()`. `path.resolve`
          // (unlike `path.join`) normalizes `..` segments, so the prefix
          // check correctly catches escape attempts.
          const normalized = pathHelper.resolve(packagePath, entryPoint);
          const packagePathPrefix = packagePath.endsWith(pathHelper.SEPARATOR)
            ? packagePath
            : packagePath + pathHelper.SEPARATOR;
          if (normalized !== packagePath && !normalized.startsWith(packagePathPrefix)) {
            return null;
          }

          const resolved = pathToFileURL(normalized).href;
          resolvedSpecifierCache.set(cacheKey, resolved);
          return resolved;
        } catch (_) {
          /* expected: package.json not found at this level, walk up */
          const parent = pathHelper.dirname(searchDir);
          if (parent === searchDir) break;
          searchDir = parent;
        }
      }

      // Intentionally do NOT cache nulls — a missing-then-installed package
      // should be resolvable on the next pass without a process restart.
      return null;
    };

    const rewritePackageImports = (input: string, pkg: string, resolvedUrl: string): string => {
      const escapedPkg = escapeRegExp(pkg);
      const staticImportRegex = new RegExp(
        `(^|[\\s;{}])((?:import|export)\\b[^"']*?\\bfrom\\s+)["']${escapedPkg}["']`,
        "g",
      );
      const dynamicImportRegex = new RegExp(`import\\s*\\(\\s*["']${escapedPkg}["']\\s*\\)`, "g");
      const sideEffectRegex = new RegExp(
        `(^|[\\n;{}])(\\s*)import\\s+["']${escapedPkg}["'](\\s*;?)`,
        "g",
      );

      return input
        .replace(staticImportRegex, (match, lead: string, head: string) => {
          if (TYPE_ONLY_STATIC_RE.test(lead + head)) return match;
          return `${lead}${head}"${resolvedUrl}"`;
        })
        .replace(dynamicImportRegex, `import("${resolvedUrl}")`)
        .replace(
          sideEffectRegex,
          (_m, lead: string, indent: string, tail: string) =>
            `${lead}${indent}import "${resolvedUrl}"${tail}`,
        );
    };

    // Collect every bare specifier the transformed source still imports,
    // then resolve each to a file:// URL in the project's node_modules.
    // With `packages: "external"` in the discovery bundler, npm packages a
    // tool/agent depends on (e.g. `pdf-parse`, `mammoth`, `react/jsx-runtime`)
    // survive as bare imports here and need explicit resolution before the
    // temp module is loaded from outside the project's resolution root.
    const collectBareSpecifiers = (input: string): string[] => {
      const specifiers = new Set<string>();
      // Matches `import x from "spec"`, `export { x } from "spec"`,
      // `export * from "spec"`. The leading-context capture lets us skip
      // `import type` / `export type` lines, which TypeScript erases at
      // emit time and must not trigger filesystem resolution.
      for (
        const match of input.matchAll(
          /(?:^|[\s;{}])((?:import|export)\b[^"']*?\bfrom\s+)["']([^"']+)["']/g,
        )
      ) {
        const head = match[1] ?? "";
        const s = match[2];
        if (TYPE_ONLY_STATIC_RE.test(head)) continue;
        if (s && isUnprefixedNpmSpecifier(s)) specifiers.add(s);
      }
      for (const match of input.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
        const s = match[1];
        if (s && isUnprefixedNpmSpecifier(s)) specifiers.add(s);
      }
      // Side-effect imports: `import "reflect-metadata";`, `import "dotenv/config";`.
      for (
        const match of input.matchAll(
          /(?:^|[\n;{}])\s*import\s+["']([^"']+)["']\s*;?/g,
        )
      ) {
        const s = match[1];
        if (s && isUnprefixedNpmSpecifier(s)) specifiers.add(s);
      }
      return [...specifiers];
    };

    // Resolve every bare specifier in parallel — each lookup is independent
    // node_modules I/O. Apply the resulting rewrites sequentially against
    // the same source string.
    const specifiers = collectBareSpecifiers(transformed);
    const resolvedPairs = await Promise.all(
      specifiers.map(async (pkg) => [pkg, await resolvePackageToFileUrl(pkg)] as const),
    );
    for (const [pkg, resolvedUrl] of resolvedPairs) {
      if (!resolvedUrl) continue;
      transformed = rewritePackageImports(transformed, pkg, resolvedUrl);
    }

    const resolveRuntimeSpecifierToFileUrl = (specifier: string): string | null => {
      try {
        const resolved = import.meta.resolve(specifier);
        return resolved && resolved !== specifier ? resolved : null;
      } catch (_) {
        return null;
      }
    };

    const rewriteResolvedSpecifierImports = (
      input: string,
      specifier: string,
      resolvedUrl: string,
    ): string => {
      const escapedSpecifier = escapeRegExp(specifier);
      return input
        .replace(new RegExp(`from\\s*["']${escapedSpecifier}["']`, "g"), `from "${resolvedUrl}"`)
        .replace(
          new RegExp(`import\\s*\\(\\s*["']${escapedSpecifier}["']\\s*\\)`, "g"),
          `import("${resolvedUrl}")`,
        );
    };

    // Handle veryfront package imports
    let vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
    let exportsMap: Record<string, string | { import?: string }> = {};

    try {
      const vfPackageJsonPath = pathHelper.join(vfPackagePath, "package.json");
      const pkgJson = JSON.parse(await fs.readTextFile(vfPackageJsonPath));
      exportsMap = pkgJson.exports || {};
    } catch (_) {
      /* expected: veryfront package.json not found, fallback to deno.json search */
      // Search for deno.json in parent directories
      let searchDir = projectDir;

      for (let i = 0; i < 5; i++) {
        try {
          const denoJsonPath = pathHelper.join(searchDir, "deno.json");
          const denoJson = JSON.parse(await fs.readTextFile(denoJsonPath));
          if (denoJson.name === "veryfront" && denoJson.exports) {
            exportsMap = denoJson.exports;
            vfPackagePath = searchDir;
            break;
          }
        } catch (_) {
          /* expected: deno.json not found at this level */
        }
        searchDir = pathHelper.dirname(searchDir);
      }
    }

    const getExportPath = (entry: string | { import?: string } | undefined): string | null => {
      if (!entry) return null;
      if (typeof entry === "string") return entry;
      return entry.import ?? null;
    };

    const veryfrontSpecifiers = new Set<string>();
    for (const match of transformed.matchAll(/from\s+["'](veryfront(?:\/[^"']+)?)["']/g)) {
      const specifier = match[1];
      if (specifier) veryfrontSpecifiers.add(specifier);
    }
    for (
      const match of transformed.matchAll(/import\s*\(\s*["'](veryfront(?:\/[^"']+)?)["']\s*\)/g)
    ) {
      const specifier = match[1];
      if (specifier) veryfrontSpecifiers.add(specifier);
    }

    for (const specifier of veryfrontSpecifiers) {
      const resolvedUrl = resolveRuntimeSpecifierToFileUrl(specifier);
      if (resolvedUrl) {
        transformed = rewriteResolvedSpecifierImports(transformed, specifier, resolvedUrl);
      }
    }

    // Rewrite veryfront subpath imports
    transformed = transformed.replace(
      /from\s+["'](veryfront\/[^"']+)["']/g,
      (match, fullSpecifier: string) => {
        const subpath = "./" + fullSpecifier.replace("veryfront/", "");
        const exportPath = getExportPath(exportsMap[subpath]);
        if (!exportPath) return match;

        const resolvedPath = pathHelper.join(vfPackagePath, exportPath);
        return `from "${pathToFileURL(resolvedPath).href}"`;
      },
    );

    // Rewrite bare veryfront import
    transformed = transformed.replace(/from\s+["']veryfront["']/g, () => {
      const exportPath = getExportPath(exportsMap["."]);
      if (!exportPath) return 'from "veryfront"';

      const resolvedPath = pathHelper.join(vfPackagePath, exportPath);
      return `from "${pathToFileURL(resolvedPath).href}"`;
    });
  } catch (_) {
    /* expected: Node.js URL module unavailable in non-Node runtime */
    return transformed;
  }

  return transformed;
}
