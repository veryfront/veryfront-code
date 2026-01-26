/**
 * Markdown styling utilities for the markdown compiler.
 *
 * These classes are added dynamically to compiled markdown output,
 * so they must be safelisted for Tailwind JIT compilation.
 */

/** Layout classes always applied to markdown wrapper */
const LAYOUT_CLASSES = ["mx-auto", "p-4"];

/** Typography classes (requires @tailwindcss/typography plugin) */
const PROSE_CLASSES = ["prose", "dark:prose-invert"];

/**
 * Get all classes that need to be safelisted for Tailwind.
 * These are added dynamically by the markdown compiler.
 */
export function getMarkdownSafelistClasses(): string[] {
  return [...LAYOUT_CLASSES, ...PROSE_CLASSES];
}

/**
 * Build the className for a markdown wrapper element.
 *
 * @param frontmatter - Extracted frontmatter from the markdown file
 * @returns Base classes to apply to the markdown wrapper
 *
 * @example
 * // Default: includes prose styling
 * getMarkdownWrapperClasses({}) // "prose dark:prose-invert mx-auto p-4"
 *
 * @example
 * // With prose: false in frontmatter
 * getMarkdownWrapperClasses({ prose: false }) // "mx-auto p-4"
 */
export function getMarkdownWrapperClasses(
  frontmatter: Record<string, unknown>,
): string {
  const useProse = frontmatter.prose !== false;
  const classes = useProse ? [...PROSE_CLASSES, ...LAYOUT_CLASSES] : LAYOUT_CLASSES;
  return classes.join(" ");
}
