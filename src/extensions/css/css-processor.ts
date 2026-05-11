/**
 * Contract interface for CSS processing engines (Tailwind-style compile
 * pipelines).
 *
 * Default implementation: `@veryfront/ext-css-tailwind`
 *
 * The contract mirrors the Tailwind v4 `compile()` surface: a stateful
 * compiler is constructed once per stylesheet and emits CSS output for the
 * set of class-name candidates discovered at render time. Core scans the
 * rendered HTML for candidates and calls `CSSCompiler.build(candidates)`
 * on each request; the compiler accumulates state across calls, so per-
 * project isolation is the caller's responsibility (see
 * `tailwind-compiler-cache.ts`).
 *
 * @module extensions/css/css-processor
 */

/** A loaded stylesheet body with the base path used to resolve relative imports. */
export interface CSSStylesheetSource {
  content: string;
  base: string;
  path: string;
}

/** A loaded module (Tailwind plugin). `module` is the plugin's default export. */
export interface CSSModuleSource {
  module: unknown;
  base: string;
  path: string;
}

/** Options passed to {@link CSSProcessor.compile}. */
export interface CSSCompileOptions {
  /** Base path used to resolve relative `@import` specifiers. */
  base: string;
  /** Resolver invoked when the compiler encounters an `@import` it doesn't recognize. */
  loadStylesheet(id: string): Promise<CSSStylesheetSource>;
  /** Resolver invoked for `@plugin` directives. */
  loadModule(id: string): Promise<CSSModuleSource>;
}

/** Stateful compiler returned by {@link CSSProcessor.compile}. */
export interface CSSCompiler {
  /**
   * Emit CSS for the supplied list of class-name candidates. Stateful — the
   * compiler accumulates candidates across calls for the lifetime of the
   * underlying compile session.
   */
  build(candidates: string[]): string;
}

/**
 * CSSProcessor contract interface.
 *
 * Implementations wire a utility-class compiler (Tailwind, UnoCSS, etc.) so
 * core's styles-builder can emit per-request CSS without importing the
 * underlying engine directly.
 */
export interface CSSProcessor {
  compile(stylesheet: string, options: CSSCompileOptions): Promise<CSSCompiler>;
}
