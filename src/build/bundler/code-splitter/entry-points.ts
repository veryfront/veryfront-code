/**
 * Entry point creation and path conversion utilities
 * @module code-splitter/entry-points
 */

import type { SplitOptions } from "./types.ts";

interface EntryPointsResult {
  entryPoints: Record<string, string>;
  routeMap: Map<string, string>;
}

export function createEntryPoints(
  routes: SplitOptions["routes"],
): EntryPointsResult {
  const entryPoints: Record<string, string> = {};
  const routeMap = new Map<string, string>();

  for (const route of routes) {
    const entryName = route.name ?? convertPathToName(route.path);
    entryPoints[entryName] = route.file;
    routeMap.set(entryName, route.path);
  }

  return { entryPoints, routeMap };
}

export function convertPathToName(path: string): string {
  if (path === "/") return "index";
  return path.replace(/^\//, "").replaceAll("/", "-");
}
