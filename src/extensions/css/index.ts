/**
 * CSS category barrel — CSS compilation and optimization contracts.
 *
 * @module extensions/css
 */

export type { CSSCompiler, CSSProcessor } from "./css-processor.ts";
export {
  assertCSSProcessor,
  captureCSSCompiler,
  captureCSSProcessor,
  CSSProcessorName,
  MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS,
  MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS,
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
