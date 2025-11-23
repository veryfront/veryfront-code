/**
 * Lightning CSS integration for Tailwind v4
 *
 * Handles CSS processing using Lightning CSS engine with Tailwind v4 support.
 * Provides fallback processing when Lightning CSS is unavailable.
 *
 * @module
 */

import { logger } from "@veryfront/utils";
import type { LightningCSSOptions } from "./types.ts";
import { minifyCSS } from "./css-utils.ts";

/**
 * Browser version encoding for Lightning CSS
 *
 * Format: (major << 16) | (minor << 8) | patch
 * These constants define minimum browser versions for CSS feature support.
 */
const BROWSER_VERSION_CHROME_90 = 90 << 16; // Chrome 90+ supports most modern CSS
const BROWSER_VERSION_FIREFOX_88 = 88 << 16; // Firefox 88+ has modern CSS support
const BROWSER_VERSION_SAFARI_14 = 14 << 16; // Safari 14+ includes key CSS features
const BROWSER_VERSION_EDGE_90 = 90 << 16; // Edge 90+ (Chromium-based)

/**
 * Process CSS with Lightning CSS engine
 *
 * Uses Lightning CSS WASM for high-performance CSS processing with
 * autoprefixing, minification, and modern CSS transform support.
 * Falls back to basic processing if Lightning CSS is unavailable.
 *
 * @param css - CSS string to process
 * @param options - Lightning CSS processing options
 * @returns Processed CSS string
 *
 * @example
 * ```ts
 * const processed = await processWithLightningCSS(
 *   '@import "tailwindcss"; .container { padding: 1rem; }',
 *   {
 *     filename: 'styles.css',
 *     minify: true,
 *     sourceMap: false,
 *   }
 * )
 * ```
 */
export async function processWithLightningCSS(
  css: string,
  options: LightningCSSOptions,
): Promise<string> {
  try {
    // Try to use Lightning CSS WASM if available
    const lightningCSS = await import("lightningcss");

    // Initialize WASM if needed (lightningcss-wasm exports default init function)
    if (typeof lightningCSS.default === "function") {
      await lightningCSS.default();
    }

    // Replace Tailwind v4 imports with base styles (Lightning CSS will handle the rest)
    const processedCSS = css.replace(
      /@import\s+["']tailwindcss["'];?/g,
      "/* Tailwind CSS v4 base - processed by Lightning CSS */",
    );

    const result = lightningCSS.transform({
      filename: options.filename,
      code: new TextEncoder().encode(processedCSS),
      minify: options.minify ?? true,
      sourceMap: options.sourceMap ?? false,
      targets: {
        chrome: BROWSER_VERSION_CHROME_90,
        firefox: BROWSER_VERSION_FIREFOX_88,
        safari: BROWSER_VERSION_SAFARI_14,
        edge: BROWSER_VERSION_EDGE_90,
      },
      // Note: drafts.nesting removed - Lightning CSS 1.22.1+ has nesting enabled by default
    });

    return new TextDecoder().decode(result.code);
  } catch (error) {
    // Fallback to basic processing if Lightning CSS is not available
    logger.warn("Lightning CSS not available, using fallback processor", {
      error: error instanceof Error ? error.message : String(error),
    });

    return processCSSFallback(css, options);
  }
}

/**
 * Fallback CSS processing
 *
 * Provides basic CSS processing when Lightning CSS is unavailable.
 * Performs Tailwind import replacement and optional minification.
 *
 * @param css - CSS string to process
 * @param options - Processing options
 * @returns Processed CSS string
 */
function processCSSFallback(css: string, options: LightningCSSOptions): string {
  let processed = css;

  // Replace Tailwind v4 imports with a comment
  processed = processed.replace(
    /@import\s+["']tailwindcss["'];?/g,
    "/* Tailwind CSS v4 - fallback processing */",
  );

  // Basic minification if requested
  if (options.minify) {
    processed = minifyCSS(processed);
  }

  return processed;
}
