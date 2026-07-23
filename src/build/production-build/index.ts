/**
 * Production build stages for static output, client assets, and manifests.
 *
 * @example Generate a dry-run build through the orchestration entry point.
 * ```ts
 * import { buildProduction } from "#veryfront/build/production-build/index.ts";
 *
 * const stats = await buildProduction({
 *   projectDir: ".",
 *   outputDir: ".veryfront/output",
 *   dryRun: true,
 * });
 * ```
 *
 * @module build/production-build
 */

export { type AssetStats, copyStaticAssets, loadClientStyles } from "./asset-generation.ts";
export {
  type ClientScriptGenerationOptions,
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
export {
  generateLocalReleaseAssetManifest,
  LOCAL_RELEASE_ASSET_MANIFEST_PATH,
  type LocalReleaseAssetOptions,
} from "./local-release-assets.ts";
export { collectAllRoutes, type CollectedRoutes } from "./build/index.ts";
