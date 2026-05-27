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
 * Rewrite imports for Deno runtime
 * - Converts npm package imports to npm: specifier format
 * - Resolves relative imports to absolute file:// URLs
 * - For compiled binaries, rewrites veryfront imports to use globals
 */
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

function rewriteBareNpmImportsForDeno(code: string): string {
  return code
    .replace(/from\s+["']([^"']+)["']/g, (match, specifier: string) => {
      return isUnprefixedNpmSpecifier(specifier) ? `from "npm:${specifier}"` : match;
    })
    .replace(/import\s*\(\s*["']([^"']+)["']\s*\)/g, (match, specifier: string) => {
      return isUnprefixedNpmSpecifier(specifier) ? `import("npm:${specifier}")` : match;
    });
}

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

    // Resolve npm package to file URL
    const resolvePackageToFileUrl = async (packageName: string): Promise<string | null> => {
      let searchDir = projectDir;

      for (let i = 0; i < 10; i++) {
        const packagePath = pathHelper.join(searchDir, "node_modules", packageName);
        const packageJsonPath = pathHelper.join(packagePath, "package.json");

        try {
          const pkgJson = JSON.parse(await fs.readTextFile(packageJsonPath));
          const dotExport = pkgJson.exports?.["."];
          const entryPoint =
            (typeof dotExport === "string" ? dotExport : dotExport?.import ?? dotExport?.default) ??
              pkgJson.module ??
              pkgJson.main ??
              "index.js";

          return pathToFileURL(pathHelper.join(packagePath, entryPoint)).href;
        } catch (_) {
          /* expected: package.json not found at this level, walk up */
          const parent = pathHelper.dirname(searchDir);
          if (parent === searchDir) break;
          searchDir = parent;
        }
      }

      return null;
    };

    // Rewrite package imports
    const rewritePackageImports = async (input: string, pkg: string): Promise<string> => {
      const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const staticImportRegex = new RegExp(`from\\s*["']${escapedPkg}["']`, "g");
      const dynamicImportRegex = new RegExp(`import\\s*\\(\\s*["']${escapedPkg}["']\\s*\\)`, "g");

      if (!staticImportRegex.test(input) && !dynamicImportRegex.test(input)) return input;

      const resolvedUrl = await resolvePackageToFileUrl(pkg);
      if (!resolvedUrl) return input;

      return input
        .replace(staticImportRegex, `from "${resolvedUrl}"`)
        .replace(dynamicImportRegex, `import("${resolvedUrl}")`);
    };

    // Collect every bare specifier the transformed source still imports,
    // then resolve each to a file:// URL in the project's node_modules.
    // With `packages: "external"` in the discovery bundler, npm packages a
    // tool/agent depends on (e.g. `pdf-parse`, `mammoth`) survive as bare
    // imports here and need explicit resolution before the temp module is
    // loaded from outside the project's resolution root.
    const collectBareSpecifiers = (input: string): string[] => {
      const specifiers = new Set<string>();
      for (const match of input.matchAll(/from\s*["']([^"']+)["']/g)) {
        const s = match[1];
        if (s && isUnprefixedNpmSpecifier(s)) specifiers.add(s);
      }
      for (const match of input.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
        const s = match[1];
        if (s && isUnprefixedNpmSpecifier(s)) specifiers.add(s);
      }
      return [...specifiers];
    };

    for (const pkg of collectBareSpecifiers(transformed)) {
      transformed = await rewritePackageImports(transformed, pkg);
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
