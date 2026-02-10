/**
 * Transforms Esm
 *
 * @module transforms/esm
 */

export { runPipeline, TransformStage, transformToESM } from "../pipeline/index.ts";

export type { TransformContext, TransformOptions } from "./types.ts";

export type {
  PipelineConfig,
  TransformContext as PipelineContext,
  TransformOptions as PipelineOptions,
  TransformPlugin,
  TransformResult,
} from "../pipeline/types.ts";

export { computeShortContentHash, getLoaderFromPath, needsTransform } from "./transform-utils.ts";

export { addDepsToEsmShUrls, resolveReactImports } from "./react-imports.ts";
export { resolvePathAliases, resolveRelativeImports } from "./path-resolver.ts";
export { rewriteBareImports, rewriteVendorImports } from "./import-rewriter.ts";
