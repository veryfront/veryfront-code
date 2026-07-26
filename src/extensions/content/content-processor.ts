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

/** Build mode made available to content-pipeline integrations. */
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

/** Syntax family used when classifying document metadata. */
export type ContentSyntax = "markdown" | "mdx";

/** Options for syntax-aware frontmatter extraction. */
export interface ContentFrontmatterOptions {
  /** Source document content. */
  content: string;
  /** Optional frontmatter pre-seed merged with document metadata. */
  frontmatter?: Record<string, unknown>;
  /** Parser grammar used to distinguish metadata from rendered content. */
  syntax: ContentSyntax;
}

/** Source body and merged metadata returned by frontmatter extraction. */
export interface ContentFrontmatterResult {
  /** Source with YAML and parser-recognized metadata declarations removed. */
  body: string;
  /** Merged document metadata. */
  frontmatter: Record<string, unknown>;
}

/**
 * Values injected into a generated MDX program after the source document has
 * been parsed. Values must be finite JSON data stored in plain objects, dense
 * arrays, and data properties; dates normalize to ISO strings. Accessors,
 * symbols, cycles, sparse arrays, non-plain objects, and non-finite numbers are
 * rejected. Keys must be valid JavaScript identifiers, and one key cannot be
 * both a binding and an export.
 */
export interface ContentModuleValues {
  /** Module-local constants available to MDX expressions. */
  bindings?: Readonly<Record<string, unknown>>;
  /** Named ESM constants exported by the generated module. */
  exports?: Readonly<Record<string, unknown>>;
}

/** Options for {@link ContentProcessor.compileMdx} and {@link ContentProcessor.compileMarkdown}. */
export interface ContentCompileOptions {
  /**
   * Build mode. Defaults to "production" when omitted. This does not select
   * React's JSX runtime: generated MDX uses the portable runtime in both modes
   * so one module graph cannot mix incompatible React runtime instances.
   */
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
  /** Optional prefix for browser filesystem and project-alias module URLs. */
  baseUrl?: string;
  /** When true, preserves node-position metadata for studio overlays. */
  studioEmbed?: boolean;
  /** MDX output shape. Defaults to "program". */
  outputFormat?: "program" | "function-body";
  /** Module that supplies `useMDXComponents` to generated program output. */
  providerImportSource?: string;
  /** Structured values injected into generated MDX program output. */
  moduleValues?: ContentModuleValues;
  /** Additional remark plugins, including `[plugin, ...parameters]` tuples. */
  remarkPlugins?: ContentPlugin[];
  /** Additional rehype plugins, including `[plugin, ...parameters]` tuples. */
  rehypePlugins?: ContentPlugin[];
}

/**
 * Opaque unified-compatible plugin or `[plugin, ...parameters]` tuple. The
 * contract stays independent of `unified` types, and implementations preserve
 * tuple boundaries and list order.
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
  /**
   * Stable identity for every parser/plugin/compiler input that can change
   * emitted output. Core disables persistent compilation caching when absent.
   */
  readonly cacheIdentity?: string;
  /** Explicit promise that compilation results support structured cloning. */
  readonly resultIsolation?: "structured-clone";
  /**
   * Parse YAML and syntax-aware static metadata without treating examples,
   * comments, expressions, or malformed documents as declarations.
   */
  extractFrontmatter(options: ContentFrontmatterOptions): ContentFrontmatterResult;
  /** Process MDX source into compiled code and extracted metadata. */
  compileMdx(options: ContentCompileOptions): Promise<ContentProcessingResult>;
  /** Process plain Markdown into compiled code and extracted metadata. */
  compileMarkdown(options: ContentCompileOptions): Promise<ContentProcessingResult>;
  /** Return the canonical remark plugin list. */
  getRemarkPlugins(): ContentPlugin[];
  /** Return the canonical rehype plugin list. */
  getRehypePlugins(): ContentPlugin[];
}
