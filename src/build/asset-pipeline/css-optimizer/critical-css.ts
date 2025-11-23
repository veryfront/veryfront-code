/**
 * Critical CSS Extraction Module
 *
 * Extracts above-the-fold (critical) CSS from stylesheets based on HTML content.
 * This helps optimize initial page load by inlining critical styles.
 */

import { logger } from "@veryfront/utils";
import type { CriticalCSSResult, CSSOptimizationOptions } from "@veryfront/types";
import { basicMinify, extractSelectorsFromHTML } from "./utils.ts";

/**
 * Extract critical CSS from a CSS file based on HTML content
 */
export async function extractCriticalCSS(
  cssPath: string,
  htmlContent: string,
  options: CSSOptimizationOptions,
): Promise<CriticalCSSResult> {
  logger.debug(`Extracting critical CSS from ${cssPath}`);

  const css = await Deno.readTextFile(cssPath);

  // Simple critical CSS extraction based on HTML structure
  // In production, you might use a more sophisticated tool like 'critical'

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
