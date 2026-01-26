/**
 * Build Orchestration Module
 *
 * Core build system orchestration, execution, and cleanup.
 * Provides the main build workflow coordination and production build entry points.
 *
 * @example
 * ```typescript
 * import { buildProduction, type BuildOptions } from "#veryfront/server/build/build'
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
export { buildProduction, cleanupCaches, cleanupRenderer, logBuildCompletion, } from "./build-orchestrator.js";
export { executeBuild } from "./build-executor.js";
export { initializeBuildContext, normalizeBuildOptions, } from "./build-initializer.js";
export { setupBuildDirectories } from "./build-setup.js";
export { cleanupCaches as cleanupCachesUtil, cleanupRenderer as cleanupRendererUtil, logBuildCompletion as logCompletion, performCleanup, } from "./build-cleanup.js";
export { runCodeSplitting } from "./code-splitter-orchestrator.js";
export { copyAssets, generateClientScripts, generateManifestAndServiceWorker, generateRedirectsFile, } from "./output-generator.js";
export * from "./route-collector.js";
