/**
 * Route Collector Module
 *
 * Handles collection of routes from the project:
 * - Pages routes collection
 * - App routes collection
 * - Route filtering based on include/exclude patterns
 */

import { serverLogger as logger } from "#veryfront/utils";
import { collectAppRoutes, collectPagesRoutes } from "#veryfront/server/build-routes.ts";
// Direct import from base.ts to avoid circular dependency through barrel
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { AppRouteInfo, RouteInfo } from "#veryfront/server/build-types.ts";

export interface CollectedRoutes {
  pages: RouteInfo[];
  app: AppRouteInfo[];
}

/**
 * Collect all routes from the project
 */
export async function collectAllRoutes(
  adapter: RuntimeAdapter,
  projectDir: string,
  ssg: boolean,
  include?: string[],
  exclude?: string[],
): Promise<CollectedRoutes> {
  if (!ssg) {
    logger.info("[BUILD] SSG disabled, skipping route collection");
    return { pages: [], app: [] };
  }

  const [pages, app] = await Promise.all([
    collectPagesRoutes(adapter, projectDir, include, exclude),
    collectAppRoutes(adapter, projectDir, include, exclude),
  ]);

  logger.info(`[BUILD] Collected routes: ${pages.length} pages, ${app.length} app`);
  if (app.length > 0) {
    logger.info(`[BUILD] App routes: ${app.map((r) => r.path).join(", ")}`);
  }

  return { pages, app };
}
