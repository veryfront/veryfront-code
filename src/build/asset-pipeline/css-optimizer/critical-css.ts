import { logger } from "#veryfront/utils";
import type { CriticalCSSResult, CSSOptimizationOptions } from "./types/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { basicMinify, extractSelectorsFromHTML } from "./utils.ts";
import { partitionCriticalCSS } from "./css-rule-parser.ts";

const fs = createFileSystem();
const encoder = new TextEncoder();

export function extractCriticalCSS(
  cssPath: string,
  htmlContent: string,
  options: CSSOptimizationOptions,
): Promise<CriticalCSSResult> {
  const shouldMinify = options.minify ?? true;

  return withSpan(
    "build.asset.extractCriticalCSS",
    async (): Promise<CriticalCSSResult> => {
      logger.debug("Extracting critical CSS");

      const css = await fs.readTextFile(cssPath);
      const criticalSelectors = new Set(extractSelectorsFromHTML(htmlContent));
      const partitioned = partitionCriticalCSS(css, criticalSelectors);
      const criticalCSS = shouldMinify ? basicMinify(partitioned.critical) : partitioned.critical;
      const remainingCSS = shouldMinify
        ? basicMinify(partitioned.remaining)
        : partitioned.remaining;

      return {
        critical: criticalCSS,
        remaining: remainingCSS,
        criticalSize: encoder.encode(criticalCSS).length,
        remainingSize: encoder.encode(remainingCSS).length,
      };
    },
    {
      "css.minify": shouldMinify,
    },
  );
}
