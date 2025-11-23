/**
 * Entry point creation and path conversion utilities
 * @module code-splitter/entry-points
 */

import type { SplitOptions } from "./types.ts";

/**
 * Result of entry point creation
 */
export interface EntryPointsResult {
  /** Map of entry point names to file paths */
  entryPoints: Record<string, string>;
  /** Map of entry point names to route paths */
  routeMap: Map<string, string>;
}

/**
 * Creates esbuild entry points from route configurations
 *
 * @param routes - Route configurations to convert
 * @returns Entry points record and route mapping
 */
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

/**
 * Converts a route path to a valid entry point name
 *
 * @param path - Route path (e.g., "/", "/about", "/blog/post")
 * @returns Entry point name (e.g., "index", "about", "blog-post")
 *
 * @example
 * ```ts
 * convertPathToName("/") // "index"
 * convertPathToName("/about") // "about"
 * convertPathToName("/blog/post") // "blog-post"
 * ```
 */
export function convertPathToName(path: string): string {
  if (path === "/") return "index";
  return path.replace(/^\//, "").replace(/\//g, "-");
}
