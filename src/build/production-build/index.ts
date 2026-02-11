/**
 * Build Production Build
 *
 * @module build/production-build
 */

export { type AssetStats, copyStaticAssets, loadClientStyles } from "./asset-generation.ts";
export {
  generateAppModule,
  generateClientModule,
  generateImportMap,
  generatePrefetchScript,
  generateRouterScript,
} from "./client-runtime.ts";
export {
  type BuildManifest,
  generateManifest,
  generateRedirects,
  type ManifestOptions,
} from "./manifest.ts";
export {
  buildAppRoutes,
  buildPagesRoutes,
  type PageRenderResult,
  type SSGOptions,
  type SSGStats,
} from "./static-generation.ts";
export {
  buildProduction,
  cleanupCaches,
  cleanupRenderer,
  logBuildCompletion,
} from "./build/index.ts";
export { type BuildExecutorOptions, type BuildResult, executeBuild } from "./build/index.ts";
export { type BuildContext, initializeBuildContext, normalizeBuildOptions } from "./build/index.ts";
export { setupBuildDirectories } from "./build/index.ts";
export {
  cleanupCachesUtil,
  cleanupRendererUtil,
  logCompletion,
  performCleanup,
} from "./build/index.ts";
export { runCodeSplitting, type SplitResult } from "./build/index.ts";
export {
  copyAssets,
  generateClientScripts,
  generateManifestAndServiceWorker,
  generateRedirectsFile,
  type OutputGeneratorOptions,
} from "./build/index.ts";
export { collectAllRoutes, type CollectedRoutes } from "./build/index.ts";
