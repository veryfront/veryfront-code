/**
 * Contract interface for CSS processing engines.
 *
 * Default implementation: `@veryfront/ext-tailwind`
 *
 * @module extensions/interfaces/css-processor
 */

/** Options passed to {@link CSSProcessor.process}. */
export interface CSSProcessOptions {
  /** Raw CSS or utility-class input. */
  content: string;
  /** Paths to source files used for scanning class usage. */
  sources?: string[];
  /** Enable minification of the output. */
  minify?: boolean;
  /** Extra implementation-specific options. */
  [key: string]: unknown;
}

/** Result returned from {@link CSSProcessor.process}. */
export interface CSSProcessResult {
  /** Processed CSS output. */
  css: string;
  /** Source map, if generated. */
  map?: string;
}

/**
 * CSSProcessor contract interface.
 *
 * Implementations compile utility classes or raw CSS into optimized
 * stylesheets ready for the browser.
 */
export interface CSSProcessor {
  /** Process CSS input and return the compiled result. */
  process(options: CSSProcessOptions): Promise<CSSProcessResult>;
  /** Merge class names using the processor's conflict-resolution strategy. */
  mergeClasses?(...classes: string[]): string;
}
