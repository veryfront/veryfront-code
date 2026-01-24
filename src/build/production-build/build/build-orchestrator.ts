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

import { serverLogger as logger } from "#veryfront/utils";
import type { BuildOptions, BuildStats } from "#veryfront/server/build-types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
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
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

/**
 * Main build production orchestrator
 */
export function buildProduction(options: BuildOptions): Promise<BuildStats> {
  return withSpan(
    "build.production",
    async () => {
      const startTime = Date.now();
      const normalizedOptions = normalizeBuildOptions(options);

      try {
        const fs = createFileSystem();
        const exists = await fs.exists(normalizedOptions.projectDir);
        if (!exists) throw new Error("Directory does not exist");
      } catch (error) {
        logger.error(`Project directory check failed: ${error}`);
        throw toError(
          createError({
            type: "config",
            message: `Invalid project directory: ${normalizedOptions.projectDir} does not exist`,
          }),
        );
      }

      logger.info("Starting production build", options);

      const context = await withSpan(
        "build.initializeContext",
        () => initializeBuildContext(options),
        {},
      );

      await withSpan(
        "build.setupDirectories",
        () =>
          setupBuildDirectories(
            context.adapter,
            normalizedOptions.outputDir ?? "",
            normalizedOptions.dryRun ?? false,
          ),
        {},
      );

      const routes = await withSpan(
        "build.collectRoutes",
        () =>
          collectAllRoutes(
            context.adapter,
            normalizedOptions.projectDir,
            normalizedOptions.ssg ?? true,
            normalizedOptions.include,
            normalizedOptions.exclude,
          ),
        {},
      );

      const splitResult = await withSpan(
        "build.codeSplitting",
        () =>
          runCodeSplitting(
            normalizedOptions.projectDir,
            normalizedOptions.outputDir ?? "",
            routes.pages,
            normalizedOptions.enableSplitting ?? true,
            normalizedOptions.dryRun ?? false,
          ),
        {},
      );
      context.stats.chunks = splitResult.chunks;

      const buildResult = await withSpan(
        "build.execute",
        () =>
          executeBuild(routes.pages, routes.app, {
            adapter: context.adapter,
            projectDir: normalizedOptions.projectDir,
            outputDir: normalizedOptions.outputDir ?? "",
            renderer: context.renderer,
            config: context.config,
            enablePrefetch: normalizedOptions.enablePrefetch ?? true,
            chunkManifest: splitResult.manifest,
            baseUrl: "",
            dryRun: normalizedOptions.dryRun ?? false,
          }),
        {},
      );

      context.stats.pages = buildResult.pages;
      context.stats.totalSize = buildResult.totalSize;

      await withSpan(
        "build.generateOutputs",
        () =>
          generateAllOutputs({
            adapter: context.adapter,
            projectDir: normalizedOptions.projectDir,
            outputDir: normalizedOptions.outputDir ?? "",
            routes: routes.pages,
            appRoutes: routes.app,
            stats: context.stats,
            enableSplitting: normalizedOptions.enableSplitting ?? true,
            enablePrefetch: normalizedOptions.enablePrefetch ?? true,
            enableCompression: normalizedOptions.enableCompression ?? true,
            chunkManifest: splitResult.manifest,
            dryRun: normalizedOptions.dryRun ?? false,
          }),
        {},
      );

      context.stats.duration = Date.now() - startTime;
      logBuildCompletion(context.stats);

      await performCleanup(context.renderer);

      context.stats.ssgPaths = buildResult.ssgPaths;

      return context.stats;
    },
    { "build.projectDir": options.projectDir },
  );
}

// Re-export helper functions for testing
export { cleanupCaches, cleanupRenderer, logBuildCompletion };
