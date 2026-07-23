/**
 * Production build orchestration, execution, output, and cleanup stages.
 *
 * @example Run validation and rendering without materializing output.
 * ```ts
 * import { buildProduction } from "#veryfront/build/production-build/build/index.ts";
 *
 * const stats = await buildProduction({
 *   projectDir: ".",
 *   outputDir: ".veryfront/output",
 *   dryRun: true,
 * });
 * ```
 *
 * @module build/production-build/build
 */

export {
  buildProduction,
  cleanupCaches,
  cleanupRenderer,
  logBuildCompletion,
} from "./build-orchestrator.ts";

export { type BuildExecutorOptions, type BuildResult, executeBuild } from "./build-executor.ts";

export {
  type BuildContext,
  initializeBuildContext,
  normalizeBuildOptions,
} from "./build-initializer.ts";

export { setupBuildDirectories } from "./build-setup.ts";

export {
  cleanupCaches as cleanupCachesUtil,
  cleanupRenderer as cleanupRendererUtil,
  logBuildCompletion as logCompletion,
  performCleanup,
} from "./build-cleanup.ts";

export { runCodeSplitting, type SplitResult } from "./code-splitter-orchestrator.ts";

export {
  copyAssets,
  generateClientScripts,
  generateManifestAndServiceWorker,
  generateRedirectsFile,
  type OutputGeneratorOptions,
} from "./output-generator.ts";

export { collectAllRoutes, type CollectedRoutes } from "./route-collector.ts";
