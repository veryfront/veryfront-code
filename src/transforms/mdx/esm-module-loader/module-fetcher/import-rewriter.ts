/**
 * Import path rewriting for veryfront and dnt module resolution.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/import-rewriter
 */

import { dirname, join, resolve } from "#veryfront/compat/path";
import { FRAMEWORK_ROOT } from "../constants.ts";
import { resolveVeryfrontModuleUrl } from "../../../veryfront-module-urls.ts";
import { getLocalFs } from "../cache/index.ts";
import {
  findStaticImportFromSpans,
  findStaticSideEffectImportSpans,
  replaceSourceSpans,
  type SourceSpanReplacement,
} from "../utils/source-spans.ts";

/**
 * Rewrite veryfront/* imports to /_vf_modules/_veryfront/ paths for MDX module loading.
 * Uses deno.json exports/imports as the source of truth and appends ?ssr=true.
 */
export function rewriteVeryfrontImports(code: string): string {
  const replacements: SourceSpanReplacement[] = findStaticImportFromSpans(
    code,
    (specifier) => specifier.startsWith("veryfront/") ? specifier : null,
  ).flatMap(({ original, path, start, end }) => {
    const mapped = resolveVeryfrontModuleUrl(path);
    if (!mapped) return [];
    return [{
      start,
      end,
      expected: original,
      replacement: `from "${mapped}?ssr=true"`,
    }];
  });

  return replaceSourceSpans(code, replacements);
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
async function findExistingFrameworkRelativeTarget(
  absolutePath: string,
): Promise<string | null> {
  const fs = getLocalFs();
  const candidates = [absolutePath, `${absolutePath}.src`];

  if (absolutePath.endsWith(".js") || absolutePath.endsWith(".mjs")) {
    const stem = absolutePath.replace(/\.(?:m?js)$/, "");
    for (const ext of [".ts", ".tsx", ".jsx", ".js", ".mjs"]) {
      candidates.push(`${stem}${ext}.src`, `${stem}${ext}`);
    }
  }

  for (const candidate of candidates) {
    try {
      await fs.stat(candidate);
      return candidate;
    } catch {
      /* expected: candidate may not exist */
    }
  }

  return null;
}

export async function rewriteDntImports(code: string, sourceFilePath: string): Promise<string> {
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
  const needsFrameworkSourceFallback = sourceFilePath.startsWith(frameworkSrcRoot) ||
    sourceFilePath.startsWith(embeddedSrcRoot);

  let rewritten = code;
  const patterns = [
    {
      findMatches: (source: string) =>
        findStaticImportFromSpans(
          source,
          (specifier) => specifier.match(/^(\.\.?\/[^?]+)(?:\?.*)?$/)?.[1],
        ),
      buildReplacement: (path: string) => `from "file://${path}"`,
    },
    {
      findMatches: (source: string) =>
        findStaticSideEffectImportSpans(
          source,
          (specifier) => specifier.match(/^(\.\.?\/[^?]+)(?:\?.*)?$/)?.[1],
        ),
      buildReplacement: (path: string) => `import "file://${path}"`,
    },
  ] as const;

  for (const { findMatches, buildReplacement } of patterns) {
    const matches = findMatches(rewritten);
    const replacements: SourceSpanReplacement[] = [];
    for (const { original, path: relativePath, start, end } of matches) {
      const absolutePath = resolve(sourceDir, relativePath);
      const resolvedPath = needsFrameworkSourceFallback
        ? await findExistingFrameworkRelativeTarget(absolutePath) ?? absolutePath
        : absolutePath;
      replacements.push({
        start,
        end,
        expected: original,
        replacement: buildReplacement(resolvedPath),
      });
    }
    rewritten = replaceSourceSpans(rewritten, replacements);
  }

  return rewritten;
}
