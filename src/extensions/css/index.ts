/**
 * CSS category barrel — CSS processor and compiler contracts.
 *
 * @module extensions/css
 */

export type {
  CSSCompileOptions,
  CSSCompiler,
  CSSModuleSource,
  CSSProcessor,
  CSSStylesheetSource,
} from "./css-processor.ts";

export type {
  CSSOptimizationEngine,
  CSSOptimizationRequest,
  CSSOptimizationResult,
} from "./css-optimization-engine.ts";
export {
  assertCSSOptimizationEngine,
  captureCSSOptimizationEngine,
  CSSOptimizationEngineName,
  MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
} from "./css-optimization-engine.ts";

export type {
  CSSPurgeContentSource,
  CSSPurgingEngine,
  CSSPurgingRequest,
  CSSPurgingResult,
} from "./css-purging-engine.ts";
export {
  assertCSSPurgingEngine,
  captureCSSPurgingEngine,
  CSSPurgingEngineName,
  MAX_CSS_PURGING_ENGINE_IDENTITY_CHARACTERS,
} from "./css-purging-engine.ts";
