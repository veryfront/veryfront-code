// ESM transforms
export {
  addDepsToEsmShUrls,
  computeShortContentHash,
  getLoaderFromPath,
  needsTransform,
  type PipelineConfig,
  type PipelineContext,
  type PipelineOptions,
  resolvePathAliases,
  resolveReactImports,
  resolveRelativeImports,
  rewriteBareImports,
  rewriteVendorImports,
  runPipeline,
  type TransformContext,
  type TransformOptions,
  type TransformPlugin,
  type TransformResult,
  TransformStage,
  transformToESM,
} from "./esm/index.ts";

// MDX transforms
export {
  clearMDXRendererCache,
  MDXCacheAdapter,
  type MDXCacheAdapterOptions,
  type MDXCompilationResult,
  MDXRenderer,
  mdxRenderer,
  type MDXRenderOptions,
} from "./mdx/index.ts";

// Plugins
export {
  getRehypePlugins,
  getRemarkPlugins,
  rehypeMdxComponents,
  rehypePreserveNodeIds,
  remarkAddNodeId,
  remarkCodeBlocks,
  remarkMdxHeadings,
  remarkMdxImports,
  remarkMdxRemoveParagraphs,
} from "./plugins/index.ts";

// Compat re-export (esm-transform.ts duplicates esm/ exports — kept for backward compat)
// NOTE: esm-transform.ts is a subset of esm/index.ts, no unique exports

export { clearAllLocalCaches } from "./mdx/esm-module-loader/cache/index.ts";
