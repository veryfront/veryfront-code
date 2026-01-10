/**
 * Entry point creation and path conversion utilities
 * @module code-splitter/entry-points
 */

import type { SplitOptions } from "./types.ts";

export interface EntryPointsResult {
  entryPoints: Record<string, string>;
  routeMap: Map<string, string>;
}

/** Creates esbuild entry points from route configurations */
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

/** Converts a route path to a valid entry point name (e.g., "/" -> "index", "/blog/post" -> "blog-post") */
export function convertPathToName(path: string): string {
  if (path === "/") return "index";
  return path.replace(/^\//, "").replace(/\//g, "-");
}
