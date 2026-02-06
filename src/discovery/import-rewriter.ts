/**
 * Import Rewriter
 *
 * Transforms import statements for different runtime environments
 * (Deno, Node.js) and handles veryfront package resolution.
 */

import { isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";

/**
 * Rewrite imports for Deno runtime
 * - Converts npm package imports to npm: specifier format
 * - Resolves relative imports to absolute file:// URLs
 * - For compiled binaries, rewrites veryfront imports to use globals
 */
export function rewriteForDeno(code: string, fileDir: string): string {
  const npmReplacements: Array<[RegExp, string]> = [
    [/from\s+["']ai["']/g, 'from "npm:ai"'],
    [/from\s+["']ai\/([^"']+)["']/g, 'from "npm:ai/$1"'],
    [/from\s+["']@ai-sdk\/([^"']+)["']/g, 'from "npm:@ai-sdk/$1"'],
    [/from\s+["']zod["']/g, 'from "npm:zod"'],
    [/import\s*\(\s*["']ai["']\s*\)/g, 'import("npm:ai")'],
    [/import\s*\(\s*["']zod["']\s*\)/g, 'import("npm:zod")'],
  ];

  let transformed = code;
  for (const [pattern, replacement] of npmReplacements) {
    transformed = transformed.replace(pattern, replacement);
  }

  // Handle relative imports
  transformed = transformed.replace(
    /from\s+["'](\.\.\/[^"']+)["']/g,
    (_match, relativePath: string) => `from "file://${pathHelper.resolve(fileDir, relativePath)}"`,
  );

  // For compiled binaries, rewrite veryfront imports to use globals
  if (isDenoCompiled) {
    const veryfrontModules = [
      "veryfront/agent",
      "veryfront/tool",
      "veryfront/platform",
      "veryfront/prompt",
      "veryfront/resource",
    ];

    for (const mod of veryfrontModules) {
      const escapedMod = mod.replace(/\//g, "\\/");

      // Match: import { ... } from "veryfront/..."
      const importPattern = new RegExp(
        `import\\s*\\{([^}]+)\\}\\s*from\\s*["']${escapedMod}["']`,
        "g",
      );
      transformed = transformed.replace(importPattern, (_match, imports: string) => {
        return `const {${imports}} = globalThis.__VERYFRONT_MODULES__["${mod}"]`;
      });

      // Match: import * as X from "veryfront/..."
      const namespacePattern = new RegExp(
        `import\\s*\\*\\s*as\\s+(\\w+)\\s*from\\s*["']${escapedMod}["']`,
        "g",
      );
      transformed = transformed.replace(namespacePattern, (_match, name: string) => {
        return `const ${name} = globalThis.__VERYFRONT_MODULES__["${mod}"]`;
      });
    }
  }

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
        } catch {
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

    // Rewrite external package imports
    const externalPackages = [
      "zod",
      "ai",
      "@ai-sdk/anthropic",
      "@ai-sdk/openai",
      "@ai-sdk/google",
      "@ai-sdk/mistral",
      "@ai-sdk/provider",
      "@ai-sdk/provider-utils",
    ];

    for (const pkg of externalPackages) {
      transformed = await rewritePackageImports(transformed, pkg);
    }

    // Handle veryfront package imports
    let vfPackagePath = pathHelper.join(projectDir, "node_modules", "veryfront");
    let exportsMap: Record<string, string | { import?: string }> = {};

    try {
      const vfPackageJsonPath = pathHelper.join(vfPackagePath, "package.json");
      const pkgJson = JSON.parse(await fs.readTextFile(vfPackageJsonPath));
      exportsMap = pkgJson.exports || {};
    } catch {
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
        } catch {
          // continue searching
        }
        searchDir = pathHelper.dirname(searchDir);
      }
    }

    const getExportPath = (entry: string | { import?: string } | undefined): string | null => {
      if (!entry) return null;
      if (typeof entry === "string") return entry;
      return entry.import ?? null;
    };

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
  } catch {
    return transformed;
  }

  return transformed;
}
