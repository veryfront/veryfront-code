/**
 * Build Executor Module
 *
 * Handles the execution of the actual build process:
 * - Building pages routes
 * - Building app routes
 * - Coordinating SSG options
 * - Aggregating build statistics
 */

import { serverLogger as logger } from "../../../utils/index.js";
import { buildAppRoutes, buildPagesRoutes } from "../static-generation.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../../config/index.js";
import type { VeryfrontRenderer } from "../../../rendering/index.js";
import type { AppRouteInfo, RouteInfo } from "../../../server/build-types.js";
import type { ChunkManifest } from "../../bundler/index.js";

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

/**
 * Execute the build process for all routes
 */
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
  logger.info(`[BUILD] pagesStats: ${pagesStats.pages} pages built`);

  const appStats = await buildAppRoutes(appRoutes, options);
  logger.info(`[BUILD] appStats: ${appStats.pages} pages built`);

  return {
    pages: pagesStats.pages + appStats.pages,
    totalSize: pagesStats.totalSize + appStats.totalSize,
    ssgPaths: pagesStats.ssgPaths.concat(appStats.ssgPaths),
  };
}
