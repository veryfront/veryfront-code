import { join } from "#veryfront/compat/path/index.ts";

export function getRouteOutputRelativePath(routePath: string): string {
  return routePath === "/" ? "index.html" : join(routePath.slice(1), "index.html");
}

export function getRouteOutputPath(outputDir: string, routePath: string): string {
  return join(outputDir, getRouteOutputRelativePath(routePath));
}
