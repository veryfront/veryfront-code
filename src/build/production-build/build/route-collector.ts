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

// Route discovery walks directories in `readDir` order, which the filesystem
// picks (ext4 hashes entry names, so the same tree enumerates differently on
// two machines). Ordering routes by path here keeps a build's page order --
// and the `ssgPaths` it reports -- reproducible instead of runner-dependent.
function comparePaths(left: { path: string }, right: { path: string }): number {
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  return 0;
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
    logger.debug("SSG disabled, skipping route collection");
    return { pages: [], app: [] };
  }

  const [collectedPages, collectedApp] = await Promise.all([
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

  const pages = collectedPages.sort(comparePaths);
  const app = collectedApp.sort(comparePaths);

  logger.debug(`Collected routes: ${pages.length} pages, ${app.length} app`);

  if (app.length > 0) {
    logger.debug(`App routes: ${app.map((r) => r.path).join(", ")}`);
  }

  return { pages, app };
}
