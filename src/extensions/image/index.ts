/**
 * Image extension contracts.
 *
 * @module extensions/image
 */

export type {
  ImageOptimizationEngine,
  ImageOptimizationFormat,
  ImageOptimizationRequest,
  ImageOptimizationResult,
  ImageOptimizationVariantResult,
} from "./image-optimization-engine.ts";
export {
  assertImageOptimizationEngine,
  captureImageOptimizationEngine,
  ImageOptimizationEngineName,
  MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
} from "./image-optimization-engine.ts";
