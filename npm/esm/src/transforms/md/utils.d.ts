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
export declare function isInRoutableDir(filePath: string | undefined): boolean;
/**
 * Check if a markdown file should be rendered with GitHub preview styles.
 * Returns true for standalone .md files not in pages/app directories,
 * unless opted out via `prose: false` frontmatter.
 */
export declare function isMarkdownPreview(filePath: string | undefined, frontmatter?: Record<string, unknown>): boolean;
//# sourceMappingURL=utils.d.ts.map