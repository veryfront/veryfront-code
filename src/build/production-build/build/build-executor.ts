import { serverLogger } from "#veryfront/utils";
import { buildAppRoutes, buildPagesRoutes } from "../static-generation.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { VeryfrontRenderer } from "#veryfront/rendering/index.ts";
import type { AppRouteInfo, RouteInfo } from "#veryfront/server/build-types.ts";
import type { ChunkManifest } from "#veryfront/build/bundler/index.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { collectStaticRouteOutputPaths } from "../route-output-paths.ts";

const logger = serverLogger.component("build");

/** Resolved dependencies required to render all collected static routes. */
export interface BuildExecutorOptions {
  adapter: RuntimeAdapter;
  projectDir: string;
  outputDir: string;
  renderer: VeryfrontRenderer;
  config: VeryfrontConfig;
  enablePrefetch: boolean;
  chunkManifest: ChunkManifest | null;
  baseUrl: string;
  dryRun: boolean;
  releaseAssetManifest?: ReleaseAssetManifest | null;
}

/** Aggregate result from Pages Router and App Router generation. */
export interface BuildResult {
  pages: number;
  totalSize: number;
  ssgPaths: string[];
}

/** Validate route output uniqueness and render both static route families. */
export async function executeBuild(
  pagesRoutes: RouteInfo[],
  appRoutes: AppRouteInfo[],
  options: BuildExecutorOptions,
): Promise<BuildResult> {
  collectStaticRouteOutputPaths(pagesRoutes, appRoutes, options.outputDir);

  logger.info("Building static routes", {
    pagesRoutes: pagesRoutes.length,
    appRoutes: appRoutes.length,
  });
  const pagesStats = await buildPagesRoutes(pagesRoutes, options);
  const appStats = await buildAppRoutes(appRoutes, options);

  return {
    pages: pagesStats.pages + appStats.pages,
    totalSize: pagesStats.totalSize + appStats.totalSize,
    ssgPaths: [...pagesStats.ssgPaths, ...appStats.ssgPaths],
  };
}
