/**
 * On-the-fly Tailwind CSS compilation using UnoCSS
 * Scans HTML content and generates only the CSS classes that are used
 * Supports user-defined theme extensions from veryfront.config.ts
 */

import { createGenerator, type UnoGenerator } from "@unocss/core";
import presetWind from "@unocss/preset-wind";
import { serverLogger as logger } from "@veryfront/utils";
import { getUnoCSSTailwindResetUrl } from "@veryfront/core/utils/constants/cdn.ts";
import type { VeryfrontConfig } from "../../core/config/types.ts";

type TailwindConfig = VeryfrontConfig["tailwind"];

// Lazy-initialized UnoCSS generator and reset CSS
// Using lazy initialization avoids top-level await which breaks esbuild bundling
let resetTailwind = "";
let resetInitialized = false;
// deno-lint-ignore no-explicit-any
let uno: UnoGenerator<any> | null = null;
let lastConfigHash = "";

/**
 * Simple hash function to detect config changes
 */
function hashConfig(config?: TailwindConfig): string {
  return config ? JSON.stringify(config) : "";
}

/**
 * Convert Tailwind theme.extend to UnoCSS theme format
 * Maps veryfront's CSS variable-based colors to UnoCSS theme
 */
function buildUnoTheme(tailwindConfig?: TailwindConfig): Record<string, unknown> {
  const theme: Record<string, unknown> = {};
  const extend = tailwindConfig?.theme?.extend;

  if (!extend) return theme;

  // Map colors (including CSS variable references)
  if (extend.colors) {
    theme.colors = extend.colors;
  }

  // Map font families
  if (extend.fontFamily) {
    theme.fontFamily = extend.fontFamily;
  }

  // Map spacing
  if (extend.spacing) {
    theme.spacing = extend.spacing;
  }

  // Map font sizes
  if (extend.fontSize) {
    theme.fontSize = extend.fontSize;
  }

  // Map breakpoints/screens
  if (extend.screens) {
    theme.breakpoints = extend.screens;
  }

  // Map border radius
  if (extend.borderRadius) {
    theme.borderRadius = extend.borderRadius;
  }

  // Map animations
  if (extend.animation) {
    theme.animation = extend.animation;
  }

  // Map keyframes
  if (extend.keyframes) {
    theme.animation = {
      ...((theme.animation as Record<string, unknown>) || {}),
      keyframes: extend.keyframes,
    };
  }

  return theme;
}

/**
 * Lazily initialize UnoCSS generator and fetch reset CSS
 * This is called on first use instead of at module load time
 * Recreates the generator if the config has changed
 */
// deno-lint-ignore no-explicit-any
async function ensureInitialized(
  tailwindConfig?: TailwindConfig,
): Promise<{ reset: string; generator: UnoGenerator<any> }> {
  const configHash = hashConfig(tailwindConfig);

  // Recreate generator if config changed
  if (uno === null || configHash !== lastConfigHash) {
    lastConfigHash = configHash;
    const theme = buildUnoTheme(tailwindConfig);

    // deno-lint-ignore no-explicit-any
    uno = createGenerator({
      // deno-lint-ignore no-explicit-any
      presets: [presetWind()] as any,
      // Apply theme at generator level for broader support
      theme,
    });
  }

  if (!resetInitialized) {
    resetInitialized = true;
    try {
      resetTailwind = await fetch(getUnoCSSTailwindResetUrl()).then((r) => r.text());
    } catch (error) {
      logger.warn("Failed to fetch Tailwind reset CSS, using empty string:", error);
      resetTailwind = "";
    }
  }

  return { reset: resetTailwind, generator: uno };
}

/**
 * Generate Tailwind-compatible CSS from HTML content
 * Includes Tailwind's preflight/reset styles for consistent cross-browser rendering
 * @param htmlContent - The HTML to scan for class names
 * @param tailwindConfig - Optional tailwind config from veryfront.config.ts
 * @returns Generated CSS string with reset + utility classes
 */
export async function generateTailwindCSS(
  htmlContent: string,
  tailwindConfig?: TailwindConfig,
): Promise<string> {
  try {
    const { reset, generator } = await ensureInitialized(tailwindConfig);

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
    const classes = (match[1] || "").split(/\s+/);
    classes.forEach((cls) => {
      if (cls.trim()) classNames.add(cls.trim());
    });
  }

  return classNames;
}
