/**
 * On-the-fly Tailwind CSS compilation using UnoCSS
 * Scans HTML content and generates only the CSS classes that are used
 */

import { createGenerator } from "@unocss/core";
import presetWind from "@unocss/preset-wind";
import { serverLogger as logger } from "@veryfront/utils";
import { getUnoCSSTailwindResetUrl } from "@veryfront/core/utils/constants/cdn.ts";

// Fetch Tailwind reset CSS (UnoCSS built-in reset)
const resetTailwind = await fetch(getUnoCSSTailwindResetUrl()).then((r) => r.text());

// Create UnoCSS generator with Tailwind/Windi preset
const uno = createGenerator({
  presets: [
    presetWind(),
  ],
});

/**
 * Generate Tailwind-compatible CSS from HTML content
 * Includes Tailwind's preflight/reset styles for consistent cross-browser rendering
 * @param htmlContent - The HTML to scan for class names
 * @returns Generated CSS string with reset + utility classes
 */
export async function generateTailwindCSS(htmlContent: string): Promise<string> {
  try {
    // Generate CSS for all classes found in the HTML
    const result = await uno.generate(htmlContent, {
      minify: false, // Keep readable for development
    });

    // Prepend Tailwind reset/preflight CSS before utility classes
    return `${resetTailwind}\n${result.css}`;
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
