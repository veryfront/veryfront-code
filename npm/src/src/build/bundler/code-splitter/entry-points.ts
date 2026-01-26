/**
 * Entry point creation and path conversion utilities
 * @module code-splitter/entry-points
 */

import type { SplitOptions } from "./types.js";

export interface EntryPointsResult {
  entryPoints: Record<string, string>;
  routeMap: Map<string, string>;
}

export function createEntryPoints(
  routes: SplitOptions["routes"],
): EntryPointsResult {
  const entryPoints: Record<string, string> = {};
  const routeMap = new Map<string, string>();

  for (const { name, path, file } of routes) {
    const entryName = name ?? convertPathToName(path);
    entryPoints[entryName] = file;
    routeMap.set(entryName, path);
  }

  return { entryPoints, routeMap };
}

export function convertPathToName(path: string): string {
  if (path === "/") return "index";
  return path.replace(/^\//, "").replaceAll("/", "-");
}
