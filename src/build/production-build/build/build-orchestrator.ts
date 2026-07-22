import { serverLogger as logger } from "#veryfront/utils";
import type { BuildOptions, BuildStats } from "#veryfront/server/build-types.ts";
import { createError, toError } from "#veryfront/errors";
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
import { collectAllRoutes, type CollectedRoutes } from "./route-collector.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { generateLocalReleaseAssetManifest } from "../local-release-assets.ts";

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

      try {
        const outputDir = normalizedOptions.outputDir ?? "";
        const dryRun = normalizedOptions.dryRun ?? false;
        const enableSplitting = normalizedOptions.enableSplitting ?? true;
        const enablePrefetch = normalizedOptions.enablePrefetch ?? true;
        const enableCompression = normalizedOptions.enableCompression ?? true;
        // Explicit caller option > build.ssg in veryfront.config.ts > enabled.
        // Resolved here (after initializeBuildContext loads the config) so
        // every entry point — CLI, MCP tool, direct API — honors the config.
        // Default to SSG because a non-SSG build collects no routes and
        // therefore emits no pages, which is never a servable artifact.
        const ssg = normalizedOptions.ssg ?? context.config.build?.ssg ?? true;

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

        context.stats.duration = Date.now() - startTime;

        assertBuildProducedOutput(context.stats, routes, ssg, dryRun);

        logBuildCompletion(context.stats);

        return context.stats;
      } finally {
        await performCleanup(context.renderer);
      }
    },
    { "build.projectDir": options.projectDir },
  );
}

/**
 * A build that emits zero pages and zero chunks is not a deployable artifact,
 * so reporting it as a success lets broken releases through (an empty dist/
 * deployed behind a "Build completed successfully" message serves only 404s).
 * Fail the build instead, with a message that points at the actual cause.
 */
export function assertBuildProducedOutput(
  stats: BuildStats,
  routes: CollectedRoutes,
  ssg: boolean,
  dryRun: boolean,
): void {
  if (dryRun || stats.pages > 0 || stats.chunks > 0) return;

  const routeCount = routes.pages.length + routes.app.length;
  const message = !ssg
    ? "Build produced no pages because static site generation is disabled. " +
      "Remove --no-ssg (or set `build: { ssg: true }` in veryfront.config.ts) and rebuild."
    : routeCount === 0
    ? "Build produced no pages: no routes were found. " +
      "Add a page (e.g. pages/index.tsx or app/page.tsx), or loosen the --include/--exclude filters."
    : `Build produced no pages even though ${routeCount} route(s) were collected. ` +
      "Check the build log for per-route errors.";

  throw toError(createError({ type: "build", message }));
}

export { cleanupCaches, cleanupRenderer, logBuildCompletion };
