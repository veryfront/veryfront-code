/**
 * Contract interface for content transformation pipelines.
 *
 * Default implementation: `@veryfront/ext-transform-mdx`
 *
 * Implementations compile MDX / Markdown source into renderable JavaScript
 * modules. Core's `src/transforms/md/compiler` and
 * `src/transforms/mdx/compiler` delegate to the registered implementation;
 * when none is registered, the compile paths throw an actionable install
 * message pointing at `@veryfront/ext-transform-mdx`.
 *
 * The two compile methods have the same option shape on purpose so a single
 * dispatcher (see `src/transforms/mdx/compiler/index.ts::compileContent`)
 * can route on file extension. Options match the long-standing
 * `compileMDXRuntime` / `compileMarkdownRuntime` signatures — option order
 * and defaults are preserved so the extension boundary is a pure refactor,
 * not a behavior change.
 *
 * @module extensions/transform/content-transformer
 */

/** Compilation mode — dev surfaces extra diagnostics. */
export type CompilationMode = "development" | "production";

/** Where the output is destined — server-side RSC or browser bundle. */
export type CompilationTarget = "browser" | "server";

/** Runtime bundle returned by the compilation pipeline. */
export interface ContentRuntimeBundle {
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

/** Options for {@link ContentTransformer.compileMdx} and {@link ContentTransformer.compileMarkdown}. */
export interface ContentCompileOptions {
  /** Compilation mode — defaults to "production" when omitted. */
  mode?: CompilationMode;
  /** Absolute project root (used for resolving relative import rewrites). */
  projectDir: string;
  /** Source document content. */
  content: string;
  /** Optional frontmatter pre-seed merged with in-body frontmatter. */
  frontmatter?: Record<string, unknown>;
  /** Source file path hint (used in error messages + import resolution). */
  filePath?: string;
  /** Compile target — defaults to "server". */
  target?: CompilationTarget;
  /** Base URL used when rewriting bare-specifier imports. */
  baseUrl?: string;
  /** When true, preserves node-position metadata for studio overlays. */
  studioEmbed?: boolean;
}

/**
 * Opaque unified-compatible plugin entry. Kept as `unknown[] | unknown` so
 * the contract surface doesn't require consumers to depend on the `unified`
 * package directly — callers cast to the plugin-list shape they need.
 */
export type ContentPlugin = unknown | [unknown, ...unknown[]];

/**
 * ContentTransformer contract — compiles MDX/Markdown to runtime-ready JS.
 *
 * Implementations own the entire pipeline (parser, remark/rehype plugins,
 * MDX compile step, sanitization, HTML wrapping). Core only dispatches by
 * file extension and post-processes the returned bundle.
 *
 * `getRemarkPlugins()` / `getRehypePlugins()` are exposed so build-time MDX
 * compilers (which run their own @mdx-js/mdx invocations) can borrow the
 * canonical plugin list without duplicating it. Runtime compile paths
 * should prefer `compileMdx` / `compileMarkdown`.
 */
export interface ContentTransformer {
  /** Compile MDX source into a runtime bundle. */
  compileMdx(options: ContentCompileOptions): Promise<ContentRuntimeBundle>;
  /** Compile plain Markdown into a runtime bundle. */
  compileMarkdown(options: ContentCompileOptions): Promise<ContentRuntimeBundle>;
  /** Return the canonical remark plugin list. */
  getRemarkPlugins(): ContentPlugin[];
  /** Return the canonical rehype plugin list. */
  getRehypePlugins(): ContentPlugin[];
}
