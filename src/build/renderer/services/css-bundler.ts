/**
 * CSS bundling service
 */

import { bundlerLogger as logger } from "@veryfront/utils";
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
    let processedCss = source.content;

    // In production, minify CSS
    if (options.mode === "production") {
      processedCss = minifyCss(processedCss);
    }

    // Add to outputs
    result.outputs.set(source.path, {
      path: source.path,
      content: processedCss,
      type: "css",
    });

    logger.debug(`Bundled CSS: ${source.path}`);
  } catch (error) {
    logger.error(`Failed to bundle CSS ${source.path}`, error);
    result.errors.push(error as Error);
  }
}

/**
 * Simple CSS minification
 */
function minifyCss(css: string): string {
  return (
    css
      // Remove comments
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // Remove unnecessary whitespace
      .replace(/\s+/g, " ")
      // Remove space around selectors
      .replace(/\s*([{}:;,])\s*/g, "$1")
      // Remove trailing semicolon before }
      .replace(/;}/g, "}")
      // Remove quotes from urls when possible
      .replace(/url\(["']([^"']+)["']\)/g, "url($1)")
      .trim()
  );
}

/**
 * Process CSS imports
 */
export function processCssImports(css: string, _fromPath: string): string {
  // Handle @import statements
  const importRegex = /@import\s+["']([^"']+)["'];?/g;

  return css.replace(importRegex, (match, importPath) => {
    // Resolve relative imports
    if (importPath.startsWith(".")) {
      // Keep relative imports as-is for now
      // In a real implementation, we'd resolve and inline them
      return match;
    }

    return match;
  });
}

/**
 * Extract CSS variables
 */
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
