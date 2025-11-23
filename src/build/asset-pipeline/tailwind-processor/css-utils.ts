/**
 * CSS utility functions
 *
 * Provides utilities for CSS manipulation and analysis.
 *
 * @module
 */

/**
 * Simple CSS minification (fallback)
 *
 * Performs basic minification by removing comments, collapsing whitespace,
 * and removing spaces around punctuation. Used as a fallback when
 * Lightning CSS is not available.
 *
 * @param css - CSS string to minify
 * @returns Minified CSS string
 *
 * @example
 * ```ts
 * const minified = minifyCSS(`
 *   .container {
 *     padding: 1rem;
 *   }
 * `)
 * // Returns: ".container{padding:1rem}"
 * ```
 */
export function minifyCSS(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove comments
    .replace(/\s+/g, " ") // Collapse whitespace
    .replace(/\s*([{}:;,])\s*/g, "$1") // Remove space around punctuation
    .trim();
}

/**
 * Count utilities in CSS (heuristic)
 *
 * Counts unique class selectors in the CSS as a proxy for the number
 * of utility classes. This provides a rough estimate of how many
 * utilities are being used.
 *
 * @param css - CSS string to analyze
 * @returns Number of unique class selectors found
 *
 * @example
 * ```ts
 * const css = '.btn { } .btn-primary { } .btn { }'
 * const count = countUtilities(css)
 * // Returns: 2 (unique classes: .btn, .btn-primary)
 * ```
 */
export function countUtilities(css: string): number {
  // Count class selectors as a proxy for utilities
  const matches = css.match(/\.[a-zA-Z0-9_-]+/g);
  return matches ? new Set(matches).size : 0;
}
