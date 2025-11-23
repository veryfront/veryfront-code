/**
 * Build Orchestration Module
 *
 * Core build system orchestration, execution, and cleanup.
 * Provides the main build workflow coordination and production build entry points.
 *
 * @example
 * ```typescript
 * import { buildProduction, type BuildOptions } from '@veryfront/server/build/build'
 *
 * // Run production build
 * const stats = await buildProduction({
 *   projectDir: '/path/to/project',
 *   outDir: 'dist',
 *   adapter: denoAdapter
 * })
 *
 * console.log(`Built ${stats.totalPages} pages`)
 * ```
 *
 * @module server/build/build
 */

// Build orchestration (main entry point)
export {
  buildProduction,
  cleanupCaches,
  cleanupRenderer,
  logBuildCompletion,
} from "./build-orchestrator.ts";

// Build execution
export { type BuildExecutorOptions, type BuildResult, executeBuild } from "./build-executor.ts";

// Build initialization
export {
  type BuildContext,
  initializeBuildContext,
  normalizeBuildOptions,
} from "./build-initializer.ts";

// Build setup
export { setupBuildDirectories } from "./build-setup.ts";

// Build cleanup
export {
  cleanupCaches as cleanupCachesUtil,
  cleanupRenderer as cleanupRendererUtil,
  logBuildCompletion as logCompletion,
  performCleanup,
} from "./build-cleanup.ts";

// Code splitting
export { runCodeSplitting, type SplitResult } from "./code-splitter-orchestrator.ts";

// Output generation
export {
  copyAssets,
  generateClientScripts,
  generateManifestAndServiceWorker,
  generateRedirectsFile,
  type OutputGeneratorOptions,
} from "./output-generator.ts";

// Route collection
export * from "./route-collector.ts";
