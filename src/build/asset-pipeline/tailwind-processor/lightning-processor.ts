
import { logger } from "@veryfront/utils";
import type { LightningCSSOptions } from "./types.ts";
import { minifyCSS } from "./css-utils.ts";

const BROWSER_VERSION_CHROME_90 = 90 << 16;
const BROWSER_VERSION_FIREFOX_88 = 88 << 16;
const BROWSER_VERSION_SAFARI_14 = 14 << 16;
const BROWSER_VERSION_EDGE_90 = 90 << 16;

export async function processWithLightningCSS(
  css: string,
  options: LightningCSSOptions,
): Promise<string> {
  try {
    const lightningCSS = await import("lightningcss");

    if (typeof lightningCSS.default === "function") {
      await lightningCSS.default();
    }

    const processedCSS = css.replace(
      /@import\s+["']tailwindcss["'];?/g,
      " ",
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
    logger.warn("Lightning CSS not available, using fallback processor", {
      error: error instanceof Error ? error.message : String(error),
    });

    return processCSSFallback(css, options);
  }
}

function processCSSFallback(css: string, options: LightningCSSOptions): string {
  let processed = css;

  processed = processed.replace(
    /@import\s+["']tailwindcss["'];?/g,
    " ",
  );

  if (options.minify) {
    processed = minifyCSS(processed);
  }

  return processed;
}
