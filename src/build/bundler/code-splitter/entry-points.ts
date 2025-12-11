
import type { SplitOptions } from "./types.ts";

export interface EntryPointsResult {
  entryPoints: Record<string, string>;
  routeMap: Map<string, string>;
}

export function createEntryPoints(
  routes: SplitOptions["routes"],
): EntryPointsResult {
  const entryPoints: Record<string, string> = {};
  const routeMap = new Map<string, string>();

  for (const route of routes) {
    const name = route.name || convertPathToName(route.path);
    entryPoints[name] = route.file;
    routeMap.set(name, route.path);
  }

  return { entryPoints, routeMap };
}

export function convertPathToName(path: string): string {
  if (path === "/") return "index";
  return path.replace(/^\
}
