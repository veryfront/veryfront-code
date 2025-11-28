/**
 * On-the-fly Tailwind CSS compilation using UnoCSS
 * Scans HTML content and generates only the CSS classes that are used
 */

import { createGenerator, type UnoGenerator } from "@unocss/core";
import presetWind from "@unocss/preset-wind";
import { serverLogger as logger } from "@veryfront/utils";
import { getUnoCSSTailwindResetUrl } from "@veryfront/core/utils/constants/cdn.ts";

// Lazy-initialized UnoCSS generator and reset CSS
// Using lazy initialization avoids top-level await which breaks esbuild bundling
let resetTailwind: string | null = null;
let uno: UnoGenerator | null = null;

/**
 * Lazily initialize UnoCSS generator and fetch reset CSS
 * This is called on first use instead of at module load time
 */
async function ensureInitialized(): Promise<{ reset: string; generator: UnoGenerator }> {
  if (uno === null) {
    uno = createGenerator({
      presets: [
        presetWind(),
      ],
    });
  }

  if (resetTailwind === null) {
    try {
      resetTailwind = await fetch(getUnoCSSTailwindResetUrl()).then((r) => r.text());
    } catch (error) {
      logger.warn("Failed to fetch Tailwind reset CSS, using empty string:", error);
      resetTailwind = "";
    }
  }

  // TypeScript narrowing: after the if block, resetTailwind is guaranteed to be string
  return { reset: resetTailwind as string, generator: uno };
}

/**
 * Generate Tailwind-compatible CSS from HTML content
 * Includes Tailwind's preflight/reset styles for consistent cross-browser rendering
 * @param htmlContent - The HTML to scan for class names
 * @returns Generated CSS string with reset + utility classes
 */
export async function generateTailwindCSS(htmlContent: string): Promise<string> {
  try {
    const { reset, generator } = await ensureInitialized();

    // Generate CSS for all classes found in the HTML
    const result = await generator.generate(htmlContent, {
      minify: false, // Keep readable for development
    });

    // Prepend Tailwind reset/preflight CSS before utility classes
    return `${reset}\n${result.css}`;
  } catch (error) {
    logger.error("UnoCSS generation error:", error);
    // Return empty string on error to avoid breaking the page
    return "";
  }
}

/**
 * Extract class names from HTML for debugging
 */
export function extractClassNames(htmlContent: string): Set<string> {
  const classPattern = /class="([^"]*)"/g;
  const classNames = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = classPattern.exec(htmlContent)) !== null) {
    const classes = (match![1] || "").split(/\s+/);
    classes.forEach((cls) => {
      if (cls.trim()) classNames.add(cls.trim());
    });
  }

  return classNames;
}
