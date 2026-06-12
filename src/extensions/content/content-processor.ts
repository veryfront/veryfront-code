/**
 * Contract interface for content processing pipelines.
 *
 * Default implementation: `@veryfront/ext-content-mdx`
 *
 * Implementations process MDX / Markdown source into renderable JavaScript
 * modules plus extracted metadata. Core's `src/transforms/md/compiler` and
 * `src/transforms/mdx/compiler` delegate to the registered implementation;
 * when none is registered, the compile paths throw an actionable install
 * message pointing at `@veryfront/ext-content-mdx`.
 *
 * The two compile methods have the same option shape on purpose so a single
 * dispatcher (see `src/transforms/mdx/compiler/index.ts::compileContent`)
 * can route on file extension. Options match the long-standing
 * `compileMDXRuntime` / `compileMarkdownRuntime` signatures. Option order
 * and defaults are preserved so the extension boundary is a pure refactor,
 * not a behavior change.
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
  /** Additional remark plugins supplied by legacy build helpers. */
  remarkPlugins?: ContentPlugin[];
  /** Additional rehype plugins supplied by legacy build helpers. */
  rehypePlugins?: ContentPlugin[];
}

/**
 * Opaque unified-compatible plugin entry. Kept as an unknown-typed value or
 * tuple so the contract surface doesn't require consumers to depend on the
 * `unified` package directly. Callers cast to the plugin-list shape they need.
 */
export type ContentPlugin = unknown | [unknown, ...unknown[]];

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
