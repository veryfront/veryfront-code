/**
 * Markdown Preview Utilities
 *
 * Helpers for determining markdown preview mode and related checks.
 *
 * @module transforms/md/utils
 */

/**
 * Check if a markdown file should be rendered with GitHub preview styles.
 * Returns true for all .md files unless opted out via `prose: false` frontmatter.
 * This includes both standalone files and routable pages (pages/, app/).
 */
export function isMarkdownPreview(
  filePath: string | undefined,
  frontmatter?: Record<string, unknown>,
): boolean {
  if (frontmatter?.prose === false) return false;
  return true;
}
