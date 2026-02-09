/**
 * Import path rewriting for veryfront and dnt module resolution.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/import-rewriter
 */

import { dirname, join, resolve } from "#veryfront/compat/path";
import { FRAMEWORK_ROOT } from "../constants.ts";
import { resolveVeryfrontModuleUrl } from "../../../veryfront-module-urls.ts";

/**
 * Rewrite veryfront/* imports to /_vf_modules/_veryfront/ paths for MDX module loading.
 * Uses deno.json exports/imports as the source of truth and appends ?ssr=true.
 */
export function rewriteVeryfrontImports(code: string): string {
  return code.replace(/from\s*["'](veryfront\/[^"']+)["']/g, (_match, specifier: string) => {
    const mapped = resolveVeryfrontModuleUrl(specifier);
    if (!mapped) return `from "${specifier}"`;
    return `from "${mapped}?ssr=true"`;
  });
}

/**
 * Rewrite relative imports in framework files to absolute file:// paths.
 *
 * Framework files from the npm package (e.g., Head.js) contain relative imports like:
 *   import "../../../_dnt.polyfills.js"
 *   import { collectHead } from "../head-collector.js"
 *
 * These resolve correctly when loaded from the npm package directory, but break when
 * the transformed code is cached to a different directory (e.g., /app/.cache/veryfront-mdx-esm/...).
 * The relative path would resolve to /app/.cache/head-collector.js which doesn't exist.
 *
 * Fix: Replace ALL relative imports with absolute file:// paths resolved from the source file's directory.
 */
export function rewriteDntImports(code: string, sourceFilePath: string): string {
  // Only needed for framework files that come from the npm package.
  // IMPORTANT: Use FRAMEWORK_ROOT + "src/" or dist/framework-src to avoid matching project source files
  // that live under FRAMEWORK_ROOT (e.g., projects/myproject/components/...).
  // Without this, project relative imports get rewritten to absolute file:// source
  // paths with .js extensions, which fail because actual files are .tsx/.ts.
  const frameworkSrcRoot = join(FRAMEWORK_ROOT, "src") + "/";
  const embeddedSrcRoot = join(FRAMEWORK_ROOT, "dist", "framework-src") + "/";
  const isFrameworkFile = sourceFilePath.startsWith(frameworkSrcRoot) ||
    sourceFilePath.startsWith(embeddedSrcRoot) ||
    sourceFilePath.includes("/node_modules/");
  if (!isFrameworkFile) {
    return code;
  }

  const sourceDir = dirname(sourceFilePath);

  return code.replace(
    /from\s*["'](\.\.?\/[^"']+)["']/g,
    (_match, relativePath: string) => {
      const absolutePath = resolve(sourceDir, relativePath);
      return `from "file://${absolutePath}"`;
    },
  ).replace(
    /import\s*["'](\.\.?\/[^"']+)["']/g,
    (_match, relativePath: string) => {
      const absolutePath = resolve(sourceDir, relativePath);
      return `import "file://${absolutePath}"`;
    },
  );
}
