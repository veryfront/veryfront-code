/**
 * Code transformation pipelines — ESM module rewriting (bare imports, path
 * aliases, React), MDX compilation with caching, and remark/rehype plugins.
 *
 * @module transforms
 */

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
  type TransformTarget,
  transformToESM,
} from "./esm/index.ts";

// MDX transforms
export {
  clearMDXRendererCache,
  MDX_SYNC_RENDER_DISABLED,
  MDXCacheAdapter,
  type MDXCacheAdapterOptions,
  type MDXCompilationResult,
  MDXRenderer,
  mdxRenderer,
  type MDXRenderOptions,
  type MDXSyncRenderDisabledProps,
  type MDXSyncRenderResult,
} from "./mdx/index.ts";

// Plugins — remark/rehype plugin implementations moved into @veryfront/ext-content-mdx.
// Core still exposes the plugin list getters (backed by the extension contract).
export { getRehypePlugins, getRemarkPlugins } from "./plugins/index.ts";
export type { ContentPlugin } from "./plugins/index.ts";

export type { Loader } from "veryfront/extensions/bundler";

export { clearAllLocalCaches } from "./mdx/esm-module-loader/cache/index.ts";
