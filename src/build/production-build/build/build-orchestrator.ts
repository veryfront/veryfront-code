import { serverLogger as logger } from "#veryfront/utils";
import type { BuildOptions, BuildStats } from "#veryfront/server/build-types.ts";
import { createError, ensureError, toError } from "#veryfront/errors";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  cleanupCaches,
  cleanupRenderer,
  logBuildCompletion,
  performCleanup,
} from "./build-cleanup.ts";
import { executeBuild } from "./build-executor.ts";
import { initializeBuildContext, normalizeBuildOptions } from "./build-initializer.ts";
import {
  commitBuildOutput,
  createBuildOutputTransaction,
  rollbackBuildOutput,
  setupBuildDirectories,
} from "./build-setup.ts";
import { runCodeSplitting } from "./code-splitter-orchestrator.ts";
import { generateAllOutputs } from "./output-generator.ts";
import { collectAllRoutes } from "./route-collector.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { generateLocalReleaseAssetManifest } from "../local-release-assets.ts";

/** Build production output transactionally and return aggregate build statistics. */
export function buildProduction(options: BuildOptions): Promise<BuildStats> {
  return withSpan(
    "build.production",
    async () => {
      const startTime = Date.now();
      const normalizedOptions = normalizeBuildOptions(options);

      try {
        const fs = createFileSystem();
        const stat = await fs.stat(normalizedOptions.projectDir);
        if (!stat.isDirectory) throw new Error("Path is not a directory");
      } catch {
        logger.error("Project directory check failed");
        throw toError(
          createError({
            type: "config",
            message: "Invalid project directory: it does not exist or is not a directory",
          }),
        );
      }

      logger.info("Starting production build", {
        ssg: normalizedOptions.ssg,
        dryRun: normalizedOptions.dryRun,
      });

      const context = await withSpan(
        "build.initializeContext",
        () => initializeBuildContext(normalizedOptions),
        {},
      );
      const finalOutputDir = normalizedOptions.outputDir ?? "";
      const dryRun = normalizedOptions.dryRun ?? false;
      const outputTransaction = createBuildOutputTransaction(finalOutputDir, dryRun);
      let outputCommitted = false;
      let buildError: Error | null = null;
      let cleanupAttempted = false;
      let result: BuildStats | null = null;

      try {
        const outputDir = outputTransaction.workingOutputDir;
        const enableSplitting = normalizedOptions.enableSplitting ?? true;
        const enablePrefetch = normalizedOptions.enablePrefetch ?? true;
        const enableCompression = normalizedOptions.enableCompression ?? true;
        const ssg = normalizedOptions.ssg ?? false;

        await withSpan(
          "build.setupDirectories",
          () => setupBuildDirectories(context.adapter, outputDir, dryRun),
          {},
        );

        const releaseAssetManifest = await withSpan(
          "build.localReleaseAssets",
          () =>
            generateLocalReleaseAssetManifest({
              adapter: context.adapter,
              projectDir: normalizedOptions.projectDir,
              outputDir,
              dryRun,
              config: context.config,
            }),
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
              context.config,
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
              releaseAssetManifest,
            }),
          {},
        );

        context.stats.pages = buildResult.pages;
        context.stats.totalSize = buildResult.totalSize;
        context.stats.ssgPaths = buildResult.ssgPaths;

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
              config: context.config,
              releaseAssetManifest,
            }),
          {},
        );

        cleanupAttempted = true;
        await withSpan(
          "build.cleanup",
          () => performCleanup(context.renderer),
          {},
        );

        await withSpan(
          "build.commitOutput",
          () => commitBuildOutput(outputTransaction),
          {},
        );
        outputCommitted = true;

        context.stats.duration = Date.now() - startTime;
        logBuildCompletion(context.stats);

        result = context.stats;
      } catch (error) {
        buildError = ensureError(error);
        if (!outputCommitted) {
          try {
            await rollbackBuildOutput(outputTransaction);
          } catch (rollbackError) {
            buildError = new AggregateError(
              [buildError, ensureError(rollbackError)],
              "Production build and staging rollback both failed",
            );
          }
        }
      }

      let cleanupError: Error | null = null;
      if (!cleanupAttempted) {
        try {
          await performCleanup(context.renderer);
        } catch (error) {
          cleanupError = ensureError(error);
        }
      }

      if (buildError && cleanupError) {
        throw new AggregateError(
          [buildError, cleanupError],
          "Production build and resource cleanup both failed",
        );
      }
      if (buildError) throw buildError;
      if (cleanupError) throw cleanupError;
      if (!result) throw new Error("Production build completed without build statistics");
      return result;
    },
    {},
  );
}

export { cleanupCaches, cleanupRenderer, logBuildCompletion };
