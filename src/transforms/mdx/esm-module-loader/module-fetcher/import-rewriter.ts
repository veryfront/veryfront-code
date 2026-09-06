/**
 * Import path rewriting for veryfront and dnt module resolution.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/import-rewriter
 */

import { dirname, resolve } from "#veryfront/compat/path";
import { isFrameworkSourceFile } from "#veryfront/transforms/mdx/esm-module-loader/constants.ts";
import {
  DEFAULT_REACT_VERSION,
  type ImportSpecifierInfo,
  type RewriteContext,
  veryfrontStrategy,
} from "../../../import-rewriter/index.ts";
import { getLocalFs } from "../cache/index.ts";
import {
  findStaticImportFromSpans,
  findStaticSideEffectImportSpans,
  replaceSourceSpans,
  type SourceSpanReplacement,
  type StaticImportSpan,
} from "../utils/source-spans.ts";
import { MAX_MDX_MODULE_IMPORTS_PER_FILE } from "./limits.ts";

const MODULE_FETCHER_VERYFRONT_CONTEXT: RewriteContext = {
  filePath: "",
  projectDir: "",
  projectId: "",
  target: "ssr",
  dev: false,
  reactVersion: DEFAULT_REACT_VERSION,
};

type SpecifierMatcher = (specifier: string) => string | null | undefined;

/**
 * Run a span scanner one match past the per-file bound and fail closed there.
 *
 * Both rewriters below replace every span they collect, so accepting a
 * truncated scan would emit a half-rewritten module whose remaining specifiers
 * no longer resolve.
 */
function findBoundedSpans(
  scan: (maxMatches: number) => StaticImportSpan[],
): StaticImportSpan[] {
  const matches = scan(MAX_MDX_MODULE_IMPORTS_PER_FILE + 1);
  if (matches.length > MAX_MDX_MODULE_IMPORTS_PER_FILE) {
    throw new RangeError(
      `Module contains more than ${MAX_MDX_MODULE_IMPORTS_PER_FILE} static imports`,
    );
  }
  return matches;
}

function findBoundedStaticImportSpans(source: string, matcher: SpecifierMatcher) {
  return findBoundedSpans((maxMatches) => findStaticImportFromSpans(source, matcher, maxMatches));
}

function findBoundedStaticSideEffectImportSpans(source: string, matcher: SpecifierMatcher) {
  return findBoundedSpans((maxMatches) =>
    findStaticSideEffectImportSpans(source, matcher, maxMatches)
  );
}

function rewriteVeryfrontModuleSpecifier(specifier: string): string | null {
  const result = veryfrontStrategy.rewrite(
    {
      specifier,
      isDynamic: false,
      start: 0,
      end: specifier.length,
      statementStart: 0,
      statementEnd: 0,
      raw: {} as ImportSpecifierInfo["raw"],
    },
    MODULE_FETCHER_VERYFRONT_CONTEXT,
  );
  return result.specifier;
}

/**
 * Rewrite veryfront/* imports to /_vf_modules/_veryfront/ paths for MDX module loading.
 * Uses deno.json exports/imports as the source of truth and appends ?ssr=true.
 */
export function rewriteVeryfrontImports(code: string): string {
  const replacements: SourceSpanReplacement[] = findBoundedStaticImportSpans(
    code,
    (specifier) => specifier.startsWith("veryfront/") ? specifier : null,
  ).flatMap(({ original, path, start, end }) => {
    const mapped = rewriteVeryfrontModuleSpecifier(path);
    if (!mapped) return [];
    return [{
      start,
      end,
      expected: original,
      replacement: `from "${mapped}"`,
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
  // IMPORTANT: `isFrameworkSourceFile` matches only the framework source roots,
  // never `FRAMEWORK_ROOT` itself, so project source that lives beneath it
  // (e.g. projects/myproject/components/...) is not treated as framework source.
  // Without this, project relative imports get rewritten to absolute file:// source
  // paths with .js extensions, which fail because actual files are .tsx/.ts.
  const isFrameworkSource = isFrameworkSourceFile(sourceFilePath);
  const isFrameworkFile = isFrameworkSource || sourceFilePath.includes("/node_modules/");
  if (!isFrameworkFile) {
    return code;
  }

  const sourceDir = dirname(sourceFilePath);
  const needsFrameworkSourceFallback = isFrameworkSource;

  let rewritten = code;
  const patterns = [
    {
      findMatches: (source: string) =>
        findBoundedStaticImportSpans(
          source,
          (specifier) => specifier.match(/^(\.\.?\/[^?]+)(?:\?.*)?$/)?.[1],
        ),
      buildReplacement: (path: string) => `from "file://${path}"`,
    },
    {
      findMatches: (source: string) =>
        findBoundedStaticSideEffectImportSpans(
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
