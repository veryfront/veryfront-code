import { logger } from "#veryfront/utils";
import type { CriticalCSSResult, CSSOptimizationOptions } from "#veryfront/types";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { basicMinify, extractSelectorsFromHTML } from "./utils.ts";

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
    async () => {
      logger.debug(`Extracting critical CSS from ${cssPath}`);

      const css = await fs.readTextFile(cssPath);
      const criticalSelectors = extractSelectorsFromHTML(htmlContent);

      const critical: string[] = [];
      const remaining: string[] = [];

      for (const rule of css.split("}")) {
        if (!rule.trim()) continue;

        const fullRule = `${rule}}`;
        const selector = fullRule.match(/^([^{]+)\{/)?.[1]?.trim();
        if (!selector) continue;

        const isCritical = criticalSelectors.some((s) => selector.includes(s));
        (isCritical ? critical : remaining).push(fullRule);
      }

      const criticalCSS = critical.join("\n");
      const remainingCSS = remaining.join("\n");

      return {
        critical: shouldMinify ? basicMinify(criticalCSS) : criticalCSS,
        remaining: shouldMinify ? basicMinify(remainingCSS) : remainingCSS,
        criticalSize: encoder.encode(criticalCSS).length,
        remainingSize: encoder.encode(remainingCSS).length,
      };
    },
    {
      "css.path": cssPath,
      "css.minify": shouldMinify,
    },
  );
}
