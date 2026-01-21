/**
 * Strip Tailwind Build-Time Directives
 *
 * Removes Tailwind CSS build-time directives that aren't supported by the browser CDN.
 * These directives require a build step (PostCSS/Lightning CSS) and must be stripped
 * when serving CSS directly to the browser for CDN-based Tailwind processing.
 *
 * Supported directives for stripping:
 * - @import "tailwindcss" (v4 entry point)
 * - @plugin (v4 plugin config)
 * - @source (v4 content paths)
 * - @theme (v4 theme config) - has block with braces
 * - @variant (v4 custom variants) - has block with braces
 * - @utility (v4 custom utilities) - has block with nested braces
 * - @tailwind base/components/utilities (v3)
 * - @config (v3 config path)
 *
 * @see https://tailwindcss.com/docs/functions-and-directives
 */

/**
 * Strip a CSS at-rule with a block body (balanced braces).
 * Handles nested braces correctly.
 *
 * @param css - CSS string to process
 * @param directive - Directive name without @ (e.g., "utility", "theme")
 * @returns CSS with directive blocks removed
 */
function stripBlockDirective(css: string, directive: string): string {
  // Match @directive followed by optional name and opening brace
  const regex = new RegExp(`@${directive}\\b[^{]*\\{`, "g");
  let result = css;

  // Find all matches and their balanced closing braces
  const matches: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(css)) !== null) {
    const start = match.index;
    let braceCount = 1;
    let i = match.index + match[0].length;

    // Find matching closing brace (handle nesting)
    while (i < css.length && braceCount > 0) {
      if (css[i] === "{") braceCount++;
      else if (css[i] === "}") braceCount--;
      i++;
    }

    // Skip trailing whitespace
    while (i < css.length && /\s/.test(css[i]!)) i++;

    matches.push({ start, end: i });
  }

  // Remove matches from end to start to preserve indices
  for (let j = matches.length - 1; j >= 0; j--) {
    const { start, end } = matches[j]!;
    result = result.slice(0, start) + result.slice(end);
  }

  return result;
}

/**
 * Strip all Tailwind build-time directives from CSS.
 *
 * @param css - CSS string containing Tailwind directives
 * @returns CSS with build-time directives removed, ready for browser CDN
 */
export function stripTailwindBuildDirectives(css: string): string {
  let result = css;

  // Simple line-based directives (no block body)
  result = result
    // Tailwind v4: @import "tailwindcss"
    .replace(/@import\s+["']tailwindcss["'];?\s*/g, "")
    // Tailwind v4: @plugin "..." or @plugin "..." { ... }
    .replace(/@plugin\s+["'][^"']+["'](\s*\{[^}]*\})?;?\s*/g, "")
    // Tailwind v4: @source "..."
    .replace(/@source\s+["'][^"']+["'];?\s*/g, "")
    // Tailwind v4: @custom-variant name (selector); - inline declaration
    .replace(/@custom-variant\s+[\w-]+\s*\([^)]*\);?\s*/g, "")
    // Tailwind v4: @variant name (selector); - inline form (NOT block form)
    .replace(/@variant\s+[\w-]+\s*\([^)]*\);?\s*/g, "")
    // Tailwind v3: @tailwind base/components/utilities
    .replace(/@tailwind\s+(base|components|utilities);?\s*/g, "")
    // Tailwind v3: @config "..."
    .replace(/@config\s+["'][^"']+["'];?\s*/g, "");

  // Block directives with potentially nested braces
  // Note: @variant inline form already stripped above, this handles block form only
  result = stripBlockDirective(result, "theme");
  result = stripBlockDirective(result, "utility");

  return result;
}
