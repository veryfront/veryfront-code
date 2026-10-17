import { ensureError } from "#veryfront/errors";
import { withSpanSync } from "#veryfront/observability/tracing/otlp-setup.ts";
import { bundlerLogger as logger } from "#veryfront/utils";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";

export function bundleCss(
  source: { path: string; content: string },
  options: BundlerOptions,
  result: BundleResult,
): void {
  withSpanSync(
    "build.renderer.bundleCSS",
    () => {
      try {
        const processedCss = options.mode === "production"
          ? minifyCss(source.content)
          : source.content;

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
    },
    {
      "source.path": source.path,
      "options.mode": options.mode,
    },
  );
}

function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/(?:(?<!\s)\s+)?([{}:;,])\s*/g, "$1")
    .replace(/;}/g, "}")
    .replace(/url\(["']([^"']+)["']\)/g, "url($1)")
    .trim();
}

export function processCssImports(css: string, _fromPath: string): string {
  return css;
}

export function extractCssVariables(css: string): Record<string, string> {
  const variables: Record<string, string> = {};
  // A declaration must end at a semicolon. Scan each segment once, and start
  // names only at the beginning of a run so failed hyphen suffixes are not retried.
  const segments = css.split(";");
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index]!;
    for (
      const match of segment.matchAll(/(?<![a-zA-Z0-9-])([a-zA-Z0-9-]+):/g)
    ) {
      const run = match[1]!;
      const marker = run.indexOf("--");
      if (marker !== 0 || run.length === 2) continue;
      const value = segment.slice(match.index + match[0].length).trim();
      if (!value) continue;
      variables[run.slice(marker + 2)] = value;
      break;
    }
  }

  return variables;
}
