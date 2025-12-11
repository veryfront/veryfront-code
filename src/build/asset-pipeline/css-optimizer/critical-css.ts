
import { logger } from "@veryfront/utils";
import type { CriticalCSSResult, CSSOptimizationOptions } from "@veryfront/types";
import { createFileSystem } from "../../../platform/compat/fs.ts";
import { basicMinify, extractSelectorsFromHTML } from "./utils.ts";

const fs = createFileSystem();

export async function extractCriticalCSS(
  cssPath: string,
  htmlContent: string,
  options: CSSOptimizationOptions,
): Promise<CriticalCSSResult> {
  logger.debug(`Extracting critical CSS from ${cssPath}`);

  const css = await fs.readTextFile(cssPath);


  const criticalSelectors = extractSelectorsFromHTML(htmlContent);
  const critical: string[] = [];
  const remaining: string[] = [];

  const rules = css.split("}");

  for (const rule of rules) {
    if (!rule.trim()) continue;

    const fullRule = rule + "}";
    const selectorMatch = fullRule.match(/^([^{]+)\{/);

    if (selectorMatch && selectorMatch[1]) {
      const selector = selectorMatch[1].trim();
      const isCritical = criticalSelectors.some((s: string) => selector.includes(s));

      if (isCritical) {
        critical.push(fullRule);
      } else {
        remaining.push(fullRule);
      }
    }
  }

  const criticalCSS = critical.join("\n");
  const remainingCSS = remaining.join("\n");

  const shouldMinify = options.minify ?? true;

  return {
    critical: shouldMinify ? basicMinify(criticalCSS) : criticalCSS,
    remaining: shouldMinify ? basicMinify(remainingCSS) : remainingCSS,
    criticalSize: new TextEncoder().encode(criticalCSS).length,
    remainingSize: new TextEncoder().encode(remainingCSS).length,
  };
}
