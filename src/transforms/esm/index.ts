// Export new pipeline transformToESM (drop-in replacement for legacy transform-core)
export { runPipeline, TransformStage, transformToESM } from "../pipeline/index.ts";

// Export legacy types for backwards compatibility
export type { TransformContext, TransformOptions } from "./types.ts";

// Export pipeline types
export type {
  PipelineConfig,
  TransformContext as PipelineContext,
  TransformOptions as PipelineOptions,
  TransformPlugin,
  TransformResult,
} from "../pipeline/types.ts";

export { needsTransform } from "./transform-utils.ts";

export {
  computeContentHash,
  computeShortContentHash,
  getLoaderFromPath,
} from "./transform-utils.ts";
export { addDepsToEsmShUrls, resolveReactImports } from "./react-imports.ts";
export { resolvePathAliases, resolveRelativeImports } from "./path-resolver.ts";
export { rewriteBareImports, rewriteVendorImports } from "./import-rewriter.ts";
