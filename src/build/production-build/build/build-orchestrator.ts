
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

export async function buildProduction(options: BuildOptions): Promise<BuildStats> {
  const startTime = Date.now();

  const normalizedOptions = normalizeBuildOptions(options);

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

  const context = await initializeBuildContext(options);

  await setupBuildDirectories(
    context.adapter,
    normalizedOptions.outputDir,
    normalizedOptions.dryRun,
  );

  const routes = await collectAllRoutes(
    context.adapter,
    normalizedOptions.projectDir,
    normalizedOptions.ssg,
    normalizedOptions.include,
    normalizedOptions.exclude,
  );

  const splitResult = await runCodeSplitting(
    normalizedOptions.projectDir,
    normalizedOptions.outputDir,
    routes.pages,
    normalizedOptions.enableSplitting,
    normalizedOptions.dryRun,
  );
  context.stats.chunks = splitResult.chunks;

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

  context.stats.duration = Date.now() - startTime;

  logBuildCompletion(context.stats);

  await performCleanup(context.renderer);

  interface StatsWithSSG extends BuildStats {
    ssgPaths?: string[];
  }
  (context.stats as StatsWithSSG).ssgPaths = buildResult.ssgPaths;

  return context.stats;
}

export { cleanupCaches, cleanupRenderer, logBuildCompletion };
