/**
 * Html Styles Builder
 *
 * @module html/styles-builder
 */

export { getDevStyles } from "./dev-styles.ts";
export {
  acquireCSSGenerationSession,
  cacheCSSAsync,
  clearCSSCache,
  extractCandidates,
  extractCandidatesFromFiles,
  formatCSSError,
  generateTailwindCSS,
  getCSSByHash,
  getProjectCSS,
  hashCSS,
  invalidateCompiler,
  invalidateProjectCSS,
} from "./tailwind-compiler.ts";
export type {
  CSSErrorInfo,
  CSSGenerationSession,
  GenerateOptions,
  TailwindResult,
} from "./tailwind-compiler.ts";
