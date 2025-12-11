
import { serverLogger as logger } from "@veryfront/utils";
import { collectAppRoutes, collectPagesRoutes } from "@veryfront/server/build-routes.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";
import type { AppRouteInfo, RouteInfo } from "@veryfront/server/build-types.ts";

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
): Promise<CollectedRoutes> {
  const pages = ssg ? await collectPagesRoutes(adapter, projectDir, include, exclude) : [];
  const app = ssg ? await collectAppRoutes(adapter, projectDir, include, exclude) : [];

  logger.info(`[BUILD] Collected routes: ${pages.length} pages, ${app.length} app`);
  if (app.length > 0) {
    logger.info(`[BUILD] App routes: ${app.map((r) => r.path).join(", ")}`);
  }

  return {
    pages,
    app,
  };
}
