/**
 * Build Orchestrator Module
 *
 * Main orchestration module that coordinates the entire build process:
 * - Initializes build context
 * - Sets up build environment
 * - Collects routes
 * - Runs code splitting
 * - Executes build
 * - Generates outputs
 * - Performs cleanup
 */

import { serverLogger as logger } from "@veryfront/utils";
import type { BuildOptions, BuildStats } from "@veryfront/server/build-types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";
import {
  cleanupCaches,
  cleanupRenderer,
  logBuildCompletion,
  performCleanup,
} from "./build-cleanup.ts";
import { executeBuild } from "./build-executor.ts";
import { initializeBuildContext, normalizeBuildOptions } from "./build-initializer.ts";
import { setupBuildDirectories } from "./build-setup.ts";
import { runCodeSplitting } from "./code-splitter-orchestrator.ts";
import { generateAllOutputs } from "./output-generator.ts";
import { collectAllRoutes } from "./route-collector.ts";

/**
 * Main build production orchestrator
 */
export async function buildProduction(options: BuildOptions): Promise<BuildStats> {
  const startTime = Date.now();

  // Normalize options
  const normalizedOptions = normalizeBuildOptions(options);

  // Validate project directory exists (using cross-platform filesystem)
  try {
    const fs = createFileSystem();
    const exists = await fs.exists(normalizedOptions.projectDir);
    if (!exists) {
      throw new Error("Directory does not exist");
    }
  } catch (error) {
    logger.error(`Project directory check failed: ${error}`);
    throw toError(createError({
      type: "config",
      message: `Invalid project directory: ${normalizedOptions.projectDir} does not exist`,
    }));
  }

  logger.info("Starting production build", options);

  // Initialize build context
  const context = await initializeBuildContext(options);

  // Setup build directories
  await setupBuildDirectories(
    context.adapter,
    normalizedOptions.outputDir,
    normalizedOptions.dryRun,
  );

  // Collect routes
  const routes = await collectAllRoutes(
    context.adapter,
    normalizedOptions.projectDir,
    normalizedOptions.ssg,
    normalizedOptions.include,
    normalizedOptions.exclude,
  );

  // Run code splitting
  const splitResult = await runCodeSplitting(
    normalizedOptions.projectDir,
    normalizedOptions.outputDir,
    routes.pages,
    normalizedOptions.enableSplitting,
    normalizedOptions.dryRun,
  );
  context.stats.chunks = splitResult.chunks;

  // Execute build
  const buildResult = await executeBuild(routes.pages, routes.app, {
    adapter: context.adapter,
    projectDir: normalizedOptions.projectDir,
    outputDir: normalizedOptions.outputDir,
    renderer: context.renderer,
    config: context.config,
    enablePrefetch: normalizedOptions.enablePrefetch,
    chunkManifest: splitResult.manifest,
    baseUrl: (context.config as { build?: { baseUrl?: string } }).build?.baseUrl || "",
    dryRun: normalizedOptions.dryRun,
  });

  context.stats.pages = buildResult.pages;
  context.stats.totalSize = buildResult.totalSize;

  // Generate all outputs
  await generateAllOutputs({
    adapter: context.adapter,
    projectDir: normalizedOptions.projectDir,
    outputDir: normalizedOptions.outputDir,
    routes: routes.pages,
    appRoutes: routes.app,
    stats: context.stats,
    enableSplitting: normalizedOptions.enableSplitting,
    enablePrefetch: normalizedOptions.enablePrefetch,
    enableCompression: normalizedOptions.enableCompression,
    chunkManifest: splitResult.manifest,
    dryRun: normalizedOptions.dryRun,
  });

  // Finalize stats
  context.stats.duration = Date.now() - startTime;

  // Log completion
  logBuildCompletion(context.stats);

  // Cleanup
  await performCleanup(context.renderer);

  // Add SSG paths to stats (BuildStats already has ssgPaths as optional field)
  context.stats.ssgPaths = buildResult.ssgPaths;

  return context.stats;
}

// Re-export helper functions for testing
export { cleanupCaches, cleanupRenderer, logBuildCompletion };
