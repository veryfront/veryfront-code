/**
 * CSS bundling service
 */

import { bundlerLogger as logger } from "@veryfront/utils";
import { ensureError } from "../../../core/errors/veryfront-error.ts";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";

/**
 * Bundle CSS files
 */
export function bundleCss(
  source: { path: string; content: string },
  options: BundlerOptions,
  result: BundleResult,
): void {
  try {
    const processedCss = options.mode === "production" ? minifyCss(source.content) : source.content;

    result.outputs.set(source.path, {
      path: source.path,
      content: processedCss,
      type: "css",
    });

    logger.debug(`Bundled CSS: ${source.path}`);
  } catch (error) {
    logger.error(`Failed to bundle CSS ${source.path}`, error);
    result.errors.push(ensureError(error));
  }
}

function minifyCss(css: string): string {
  return (
    css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*([{}:;,])\s*/g, "$1")
      .replace(/;}/g, "}")
      .replace(/url\(["']([^"']+)["']\)/g, "url($1)")
      .trim()
  );
}

export function processCssImports(css: string, _fromPath: string): string {
  const importRegex = /@import\s+["']([^"']+)["'];?/g;

  return css.replace(importRegex, (match, _importPath) => {
    return match;
  });
}

export function extractCssVariables(css: string): Record<string, string> {
  const variables: Record<string, string> = {};
  const varRegex = /--([a-zA-Z0-9-]+):\s*([^;]+);/g;

  let match: RegExpExecArray | null;
  while ((match = varRegex.exec(css)) !== null) {
    const key = match[1];
    const val = match[2];
    if (key && val) variables[key] = val.trim();
  }

  return variables;
}
