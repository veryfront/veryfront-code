import { join, relative } from "#std/path.ts";
import { runtime } from "veryfront/platform";
import { getConfig } from "veryfront/config";
import { cliLogger } from "#cli/utils";
import { ApiRouteMatcher } from "#veryfront/routing/api/api-route-matcher.ts";
import { discoverAppRoutes, discoverPagesRoutes } from "#veryfront/routing/api/route-discovery.ts";
import { RouteDiscovery } from "#veryfront/server/dev-server/route-discovery.ts";

export interface RoutesOptions {
  projectDir: string;
  json?: boolean;
}

export async function routesCommand(
  projectDir: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const adapter = await runtime.get();
  const config = await getConfig(projectDir, adapter);

  const pageRouter = new ApiRouteMatcher();
  let pageRoutes: Array<{ pattern: string; page: string }> = [];
  try {
    await new RouteDiscovery(projectDir, adapter, pageRouter, config).discoverRoutes();
    pageRoutes = pageRouter.listRoutes();
  } finally {
    pageRouter.destroy();
  }

  const pages = pageRoutes
    .map((route) => ({
      pattern: route.pattern,
      file: toProjectRelativePath(projectDir, route.page),
    }))
    .sort((a, b) => a.pattern.localeCompare(b.pattern));

  const apiRouter = new ApiRouteMatcher();
  let apiRoutes: Array<{ pattern: string; page: string }> = [];
  try {
    const pagesDir = config.directories?.pages ?? "pages";
    const apiDir = join(projectDir, pagesDir, "api");
    if (await adapter.fs.exists(apiDir)) {
      await discoverPagesRoutes(apiRouter, apiDir, "/api", adapter);
    }

    const appDir = join(projectDir, config.directories?.app ?? "app");
    if (await adapter.fs.exists(appDir)) {
      await discoverAppRoutes(apiRouter, appDir, "", adapter);
    }

    apiRoutes = apiRouter.listRoutes();
  } finally {
    apiRouter.destroy();
  }

  const apis = apiRoutes
    .map((route) => ({
      pattern: route.pattern,
      file: toProjectRelativePath(projectDir, route.page),
    }))
    .sort((a, b) => a.pattern.localeCompare(b.pattern));

  if (options.json) {
    console.log(JSON.stringify({ pages, apis }, null, 2));
    return;
  }

  cliLogger.info("Pages:");
  for (const p of pages) {
    cliLogger.info(`  ${p.pattern} -> ${p.file}`);
  }

  cliLogger.info("\nAPI:");
  for (const a of apis) {
    cliLogger.info(`  ${a.pattern} -> ${a.file}`);
  }
}

function toProjectRelativePath(projectDir: string, path: string): string {
  return path.startsWith(projectDir) ? relative(projectDir, path) : path;
}
