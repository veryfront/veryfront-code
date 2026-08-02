/**
 * Asset Pipeline - Tailwind Processor
 *
 * @module build/asset-pipeline/tailwind-processor
 */

export type {
  CSSOptimizationProcessOptions,
  TailwindProcessorOptions,
  TailwindProcessResult,
} from "./types.ts";

export { TailwindProcessor } from "./processor.ts";
export { processTailwindCSS, processTailwindCSSInDirectory } from "./batch-processor.ts";
export { autoDetectContentPaths, isTailwindV4File } from "./detector.ts";
export { countUtilities } from "./css-utils.ts";
export { processWithCSSOptimization } from "./optimization-processor.ts";
