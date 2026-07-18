/**
 * Route Collector Module
 *
 * Handles collection of routes from the project:
 * - Pages routes collection
 * - App routes collection
 * - Route filtering based on include/exclude patterns
 */

import { serverLogger } from "#veryfront/utils";
import { collectAppRoutes, collectPagesRoutes } from "#veryfront/server/build-routes.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { AppRouteInfo, RouteInfo } from "#veryfront/server/build-types.ts";
import type { VeryfrontConfig } from "#veryfront/config";

const logger = serverLogger.component("build");

export interface CollectedRoutes {
  pages: RouteInfo[];
  app: AppRouteInfo[];
}

export async function collectAllRoutes(
  adapter: RuntimeAdapter,
  projectDir: string,
  ssg: boolean,
  include?: string[],
  exclude?: string[],
  config?: VeryfrontConfig,
): Promise<CollectedRoutes> {
  if (!ssg) {
    logger.info("SSG disabled, skipping route collection");
    return { pages: [], app: [] };
  }

  const [pages, app] = await Promise.all([
    collectPagesRoutes(
      adapter,
      projectDir,
      include,
      exclude,
      config?.directories?.pages ?? "pages",
    ),
    collectAppRoutes(
      adapter,
      projectDir,
      include,
      exclude,
      config?.directories?.app ?? "app",
    ),
  ]);

  logger.info(`Collected routes: ${pages.length} pages, ${app.length} app`);

  if (app.length > 0) {
    logger.info(`App routes: ${app.map((r) => r.path).join(", ")}`);
  }

  return { pages, app };
}
