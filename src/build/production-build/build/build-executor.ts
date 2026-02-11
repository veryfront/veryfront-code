import { serverLogger as logger } from "#veryfront/utils";
import { buildAppRoutes, buildPagesRoutes } from "../static-generation.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { VeryfrontRenderer } from "#veryfront/rendering/index.ts";
import type { AppRouteInfo, RouteInfo } from "#veryfront/server/build-types.ts";
import type { ChunkManifest } from "#veryfront/build/bundler/index.ts";

const log = logger.component("build");

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
}

export interface BuildResult {
  pages: number;
  totalSize: number;
  ssgPaths: string[];
}

export async function executeBuild(
  pagesRoutes: RouteInfo[],
  appRoutes: AppRouteInfo[],
  options: BuildExecutorOptions,
): Promise<BuildResult> {
  logger.info(
    `[BUILD] executeBuild: ${pagesRoutes.length} pages routes, ${appRoutes.length} app routes`,
  );

  logger.info("Building pages...");
  const pagesStats = await buildPagesRoutes(pagesRoutes, options);
  log.info(`pagesStats: ${pagesStats.pages} pages built`);

  const appStats = await buildAppRoutes(appRoutes, options);
  log.info(`appStats: ${appStats.pages} pages built`);

  return {
    pages: pagesStats.pages + appStats.pages,
    totalSize: pagesStats.totalSize + appStats.totalSize,
    ssgPaths: [...pagesStats.ssgPaths, ...appStats.ssgPaths],
  };
}
