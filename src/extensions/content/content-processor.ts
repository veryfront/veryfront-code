/**
 * Contract interface for content processing pipelines.
 *
 * Default implementation: `@veryfront/ext-content-mdx`
 *
 * Implementations process MDX or Markdown source into renderable JavaScript
 * modules plus extracted metadata. Veryfront delegates content compilation to
 * the registered implementation. When none is registered, compilation throws
 * an actionable install error for `@veryfront/ext-content-mdx`.
 *
 * The two compile methods share one option shape so callers can dispatch by
 * file extension without maintaining parallel configuration contracts.
 *
 * @module extensions/content/content-processor
 */

/** Compilation mode. Dev surfaces extra diagnostics. */
export type CompilationMode = "development" | "production";

/** Where the output is destined: server-side RSC or browser bundle. */
export type CompilationTarget = "browser" | "server";

/** Processing result returned by the content pipeline. */
export interface ContentProcessingResult {
  /** Compiled ESM source containing the default MDX/MD component export. */
  compiledCode: string;
  /** Front-matter extracted from the source document. */
  frontmatter: Record<string, unknown>;
  /** Globals injected into the module scope (MDX imports, shims). */
  globals: Record<string, unknown>;
  /** Extracted TOC headings, when the pipeline collected them. */
  headings?: { id: string; text: string; level: number }[];
  /** Source-map-adjacent line/column data keyed by node ordinal. */
  nodeMap?: Map<number, unknown>;
  /** Raw HTML (markdown preview path only). */
  rawHtml?: string;
}

/** Options for {@link ContentProcessor.compileMdx} and {@link ContentProcessor.compileMarkdown}. */
export interface ContentCompileOptions {
  /** Compilation mode. Defaults to "production" when omitted. */
  mode?: CompilationMode;
  /** Absolute project root (used for resolving relative import rewrites). */
  projectDir: string;
  /** Source document content. */
  content: string;
  /** Optional frontmatter pre-seed merged with in-body frontmatter. */
  frontmatter?: Record<string, unknown>;
  /** Source file path hint (used in error messages + import resolution). */
  filePath?: string;
  /** Compile target. Defaults to "server". */
  target?: CompilationTarget;
  /** Base URL used when rewriting bare-specifier imports. */
  baseUrl?: string;
  /** When true, preserves node-position metadata for studio overlays. */
  studioEmbed?: boolean;
  /** MDX output shape. Defaults to "program". */
  outputFormat?: "program" | "function-body";
  /** Additional remark plugins supplied by build-time compiler integrations. */
  remarkPlugins?: ContentPlugin[];
  /** Additional rehype plugins supplied by build-time compiler integrations. */
  rehypePlugins?: ContentPlugin[];
}

/**
 * Opaque unified-compatible plugin entry. The contract deliberately leaves
 * plugin values unknown so consumers do not need the `unified` package only
 * to implement this extension boundary.
 */
export type ContentPlugin = unknown;

/**
 * ContentProcessor contract for MDX/Markdown processing.
 *
 * Implementations own the entire pipeline (parser, remark/rehype plugins,
 * MDX compile step, sanitization, HTML wrapping). Core only dispatches by
 * file extension and post-processes the returned result.
 *
 * `getRemarkPlugins()` / `getRehypePlugins()` are exposed so build-time MDX
 * compilers (which run their own @mdx-js/mdx invocations) can borrow the
 * canonical plugin list without duplicating it. Runtime compile paths
 * should prefer `compileMdx` / `compileMarkdown`.
 */
export interface ContentProcessor {
  /** Process MDX source into compiled code and extracted metadata. */
  compileMdx(options: ContentCompileOptions): Promise<ContentProcessingResult>;
  /** Process plain Markdown into compiled code and extracted metadata. */
  compileMarkdown(options: ContentCompileOptions): Promise<ContentProcessingResult>;
  /** Return the canonical remark plugin list. */
  getRemarkPlugins(): ContentPlugin[];
  /** Return the canonical rehype plugin list. */
  getRehypePlugins(): ContentPlugin[];
}
