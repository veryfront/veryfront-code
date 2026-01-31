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

      const outputDir = normalizedOptions.outputDir ?? "";
      const dryRun = normalizedOptions.dryRun ?? false;
      const enableSplitting = normalizedOptions.enableSplitting ?? true;
      const enablePrefetch = normalizedOptions.enablePrefetch ?? true;
      const enableCompression = normalizedOptions.enableCompression ?? true;
      const ssg = normalizedOptions.ssg ?? true;

      await withSpan(
        "build.setupDirectories",
        () => setupBuildDirectories(context.adapter, outputDir, dryRun),
        {},
      );

      const routes = await withSpan(
        "build.collectRoutes",
        () =>
          collectAllRoutes(
            context.adapter,
            normalizedOptions.projectDir,
            ssg,
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
            outputDir,
            routes.pages,
            enableSplitting,
            dryRun,
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
            outputDir,
            renderer: context.renderer,
            config: context.config,
            enablePrefetch,
            chunkManifest: splitResult.manifest,
            baseUrl: "",
            dryRun,
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
            outputDir,
            routes: routes.pages,
            appRoutes: routes.app,
            stats: context.stats,
            enableSplitting,
            enablePrefetch,
            enableCompression,
            chunkManifest: splitResult.manifest,
            dryRun,
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

export { cleanupCaches, cleanupRenderer, logBuildCompletion };
