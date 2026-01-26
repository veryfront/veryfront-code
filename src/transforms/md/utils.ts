/**
 * Markdown Preview Utilities
 *
 * Helpers for determining markdown preview mode and related checks.
 *
 * @module transforms/md/utils
 */

/**
 * Check if a file path is inside pages/ or app/ directories.
 * Files in these directories are routed normally, not as standalone markdown.
 */
export function isInRoutableDir(filePath: string | undefined): boolean {
  if (!filePath) return false;
  return filePath.startsWith("pages/") || filePath.startsWith("app/") ||
    filePath.includes("/pages/") || filePath.includes("/app/");
}

/**
 * Check if a markdown file should be rendered with GitHub preview styles.
 * Returns true for standalone .md files not in pages/app directories,
 * unless opted out via `prose: false` frontmatter.
 */
export function isMarkdownPreview(
  filePath: string | undefined,
  frontmatter?: Record<string, unknown>,
): boolean {
  // Files in pages/ or app/ are routed normally
  if (isInRoutableDir(filePath)) return false;

  // prose: false opts out of preview styling
  if (frontmatter?.prose === false) return false;

  return true;
}
