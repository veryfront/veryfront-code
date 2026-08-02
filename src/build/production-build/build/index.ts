/**
 * Internal production-build orchestration.
 *
 * Application code should import {@link buildProduction} from
 * `"veryfront/build"`. This barrel exists for production-build internals and
 * repository tests.
 *
 * @example
 * ```typescript
 * import { buildProduction } from "veryfront/build";
 * import type { BuildOptions } from "veryfront/server";
 *
 * const options: BuildOptions = {
 *   projectDir: "/path/to/project",
 *   outputDir: "/path/to/project/dist",
 * };
 *
 * const stats = await buildProduction(options);
 * console.log(`Built ${stats.pages} pages`);
 * ```
 *
 * @module build/production-build/build
 */

export {
  buildProduction,
  type BuildProductionOptions,
  type BuildProductionReleaseAssetProviders,
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
