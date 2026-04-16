/**
 * Contract interface for content transformation pipelines.
 *
 * Default implementation: `@veryfront/ext-mdx`
 *
 * @module extensions/interfaces/content-transformer
 */

/** Options passed to {@link ContentTransformer.transform}. */
export interface ContentTransformOptions {
  /** Raw source content (e.g. MDX, Markdown). */
  source: string;
  /** File path hint for the source content. */
  filePath?: string;
  /** Additional remark/rehype plugins or processor-specific settings. */
  [key: string]: unknown;
}

/** Result returned from {@link ContentTransformer.transform}. */
export interface ContentTransformResult {
  /** Transformed output code. */
  code: string;
  /** Front-matter or metadata extracted from the source. */
  frontmatter?: Record<string, unknown>;
  /** Extracted table-of-contents headings. */
  headings?: Array<{ depth: number; text: string; slug: string }>;
}

/**
 * ContentTransformer contract interface.
 *
 * Implementations transform authoring formats (MDX, Markdown, etc.)
 * into renderable code or HTML.
 */
export interface ContentTransformer {
  /** Transform source content into its processed form. */
  transform(options: ContentTransformOptions): Promise<ContentTransformResult>;
}
