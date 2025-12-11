
import { bundlerLogger as logger } from "@veryfront/utils";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";

export function bundleCss(
  source: { path: string; content: string },
  options: BundlerOptions,
  result: BundleResult,
): void {
  try {
    let processedCss = source.content;

    if (options.mode === "production") {
      processedCss = minifyCss(processedCss);
    }

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

function minifyCss(css: string): string {
  return (
    css
      .replace(/\/\*[\s\S]*?\*\
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
