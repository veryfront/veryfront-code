/**
 * On-the-fly Tailwind CSS compilation using UnoCSS
 * Scans HTML content and generates only the CSS classes that are used
 * Supports user-defined theme extensions from veryfront.config.ts
 */

import { createGenerator, type UnoGenerator } from "@unocss/core";
import presetWind from "@unocss/preset-wind";
import { serverLogger as logger } from "@veryfront/utils";
import { getUnoCSSTailwindResetUrl } from "@veryfront/core/utils/constants/cdn.ts";
import type { VeryfrontConfig } from "@veryfront/config/types.ts";

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
 * Find arbitrary value classes with commas and create CSS aliases
 * Maps classes like "grid-cols-[0.25fr,0.5fr,0.25fr]" to their underscore equivalents
 *
 * @param htmlContent - HTML content with class attributes
 * @returns Map of original (comma) class names to normalized (underscore) class names
 */
function findCommaArbitraryClasses(htmlContent: string): Map<string, string> {
  const aliasMap = new Map<string, string>();

  // Find all class attributes
  const classPattern = /class="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = classPattern.exec(htmlContent)) !== null) {
    const classes = (match[1] || "").split(/\s+/);
    for (const cls of classes) {
      // Check if class has arbitrary value with commas inside brackets
      if (cls.includes("[") && cls.includes(",")) {
        // Create normalized version with underscores
        const normalized = cls.replace(
          /\[([^\]]*)\]/g,
          (_: string, content: string) => `[${content.replace(/,/g, "_")}]`,
        );
        if (normalized !== cls) {
          aliasMap.set(cls, normalized);
        }
      }
    }
  }

  return aliasMap;
}

/**
 * Normalize Tailwind arbitrary value syntax in class names for CSS generation
 * Converts commas to underscores within square brackets
 * e.g., "grid-cols-[0.25fr,0.5fr,0.25fr]" -> "grid-cols-[0.25fr_0.5fr_0.25fr]"
 *
 * @param htmlContent - HTML content with class attributes
 * @returns HTML with normalized class names (for CSS generation only)
 */
function normalizeArbitraryValues(htmlContent: string): string {
  return htmlContent.replace(/class="([^"]*)"/g, (_match, classes: string) => {
    const normalizedClasses = classes.replace(
      /\[([^\]]*)\]/g,
      (_bracketMatch: string, bracketContent: string) => {
        return `[${bracketContent.replace(/,/g, "_")}]`;
      },
    );
    return `class="${normalizedClasses}"`;
  });
}

/**
 * Escape a class name for use in CSS selector
 * Escapes special characters like brackets, dots, colons, etc.
 */
function escapeSelector(className: string): string {
  return className.replace(/([[\].:#(),>+~=|^$*])/g, "\\$1");
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate CSS aliases for comma-based arbitrary value classes
 * Creates rules that map comma-syntax selectors to their underscore-generated CSS
 *
 * @param aliasMap - Map of original to normalized class names
 * @param generatedCss - CSS generated from normalized classes
 * @returns Additional CSS rules for comma-syntax classes
 */
function generateCommaAliases(
  aliasMap: Map<string, string>,
  generatedCss: string,
): string {
  if (aliasMap.size === 0) return "";

  const aliasRules: string[] = [];

  for (const [original, normalized] of aliasMap) {
    // UnoCSS generates CSS selectors with escaped special chars like: .grid-cols-\[0\.25fr_0\.5fr_0\.25fr\]
    // We need to find this selector pattern in the CSS to extract the rule content
    const cssSelector = escapeSelector(normalized);
    // Escape for regex matching - the CSS has backslash-escaped chars that need double escaping in regex
    const regexPattern = escapeRegex(`.${cssSelector}`);

    // Match the rule with its content
    const rulePattern = new RegExp(`${regexPattern}\\s*\\{([^}]*)\\}`, "g");

    let ruleMatch: RegExpExecArray | null;
    while ((ruleMatch = rulePattern.exec(generatedCss)) !== null) {
      const ruleContent = ruleMatch[1];
      if (ruleContent && ruleContent.trim()) {
        // Create an alias rule for the original (comma) class name
        const escapedOriginal = escapeSelector(original);
        aliasRules.push(`.${escapedOriginal} {${ruleContent}}`);
      }
    }
  }

  return aliasRules.length > 0 ? `\n/* Comma-syntax aliases */\n${aliasRules.join("\n")}` : "";
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

    // Find classes that use comma syntax in arbitrary values
    const commaAliases = findCommaArbitraryClasses(htmlContent);

    // Normalize arbitrary values (convert commas to underscores in brackets)
    const normalizedContent = normalizeArbitraryValues(htmlContent);

    // Generate CSS for all classes found in the normalized HTML
    const result = await generator.generate(normalizedContent, {
      minify: false, // Keep readable for development
    });

    // Generate alias rules for comma-syntax classes
    const aliasRules = generateCommaAliases(commaAliases, result.css);

    // Prepend Tailwind reset/preflight CSS before utility classes
    return `${reset}\n${result.css}${aliasRules}`;
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
    for (const cls of classes) {
      if (cls.trim()) classNames.add(cls.trim());
    }
  }

  return classNames;
}
