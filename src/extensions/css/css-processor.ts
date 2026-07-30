/**
 * Contract interface for class-candidate CSS processing engines.
 *
 * Implementations are supplied by explicit extensions such as
 * `@veryfront/ext-css-tailwind`.
 *
 * The contract exposes a provider-neutral compile surface: a stateful
 * compiler is constructed once per stylesheet and emits CSS output for the
 * set of class-name candidates discovered at render time. Core scans the
 * rendered HTML for candidates and calls `CSSCompiler.build(candidates)`
 * on each request; the compiler accumulates state across calls, so exact
 * candidate-snapshot isolation is the caller's responsibility (see
 * `css-compiler-cache.ts`).
 *
 * @module extensions/css/css-processor
 */

/** Registry name used for the CSS compiler extension contract. */
export const CSSProcessorName = "CSSProcessor" as const;
export const MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS = 512;
export const MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS = 1024 * 1024;

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
 * Implementations wire a class-candidate CSS compiler so
 * core's styles-builder can emit per-request CSS without importing the
 * underlying engine directly.
 */
export interface CSSProcessor {
  /** Stable identity for every processor/compiler input that can change emitted CSS. */
  readonly cacheIdentity: string;
  /** Provider-owned stylesheet used when an application does not supply one. */
  readonly defaultStylesheet: string;
  /**
   * Compile a stylesheet. Implementations own all vendor imports, base
   * stylesheets, module resolution, and plugin loading behind this operation.
   */
  compile(stylesheet: string): Promise<CSSCompiler>;
}
