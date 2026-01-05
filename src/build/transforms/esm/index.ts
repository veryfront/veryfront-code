// Export new pipeline transformToESM (drop-in replacement for legacy transform-core)
export { transformToESM, runPipeline, TransformStage } from "../pipeline/index.ts";

// Export legacy types for backwards compatibility
export type { TransformContext, TransformOptions } from "./types.ts";

// Export pipeline types
export type {
  TransformContext as PipelineContext,
  TransformOptions as PipelineOptions,
  TransformResult,
  TransformPlugin,
  PipelineConfig,
} from "../pipeline/types.ts";

export { needsTransform } from "./transform-utils.ts";

export { computeContentHash, getLoaderFromPath } from "./transform-utils.ts";
export { addDepsToEsmShUrls, resolveReactImports } from "./react-imports.ts";
export { resolvePathAliases, resolveRelativeImports } from "./path-resolver.ts";
export { rewriteBareImports, rewriteVendorImports } from "./import-rewriter.ts";
