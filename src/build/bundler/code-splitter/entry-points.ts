/**
 * Entry point creation and path conversion utilities
 * @module code-splitter/entry-points
 */

import type { SplitOptions } from "./types.ts";

interface EntryPointsResult {
  entryPoints: Record<string, string>;
  routeMap: Map<string, string>;
}

const MAX_ENTRY_NAME_LENGTH = 160;
const SAFE_ENTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9.[\]_-]*$/;
const RESERVED_ENTRY_NAMES = new Set(["__proto__", "constructor", "prototype"]);

function assertEntryName(entryName: string, routePath: string): void {
  if (
    entryName.length === 0 ||
    entryName.length > MAX_ENTRY_NAME_LENGTH ||
    !SAFE_ENTRY_NAME.test(entryName) ||
    RESERVED_ENTRY_NAMES.has(entryName)
  ) {
    throw new TypeError(
      `Invalid code-splitter entry name ${JSON.stringify(entryName)} for route ${
        JSON.stringify(routePath)
      }`,
    );
  }
}

export function createEntryPoints(
  routes: SplitOptions["routes"],
): EntryPointsResult {
  const entryPoints: Record<string, string> = {};
  const routeMap = new Map<string, string>();
  const entryRoute = new Map<string, string>();
  const routeFiles = new Map<string, string>();

  for (const route of routes) {
    if (!route.path || !route.path.startsWith("/")) {
      throw new TypeError(`Code-splitter route paths must start with "/": ${route.path}`);
    }
    if (!route.file) {
      throw new TypeError(`Code-splitter route ${JSON.stringify(route.path)} has no source file`);
    }

    const existingFile = routeFiles.get(route.path);
    if (existingFile !== undefined) {
      throw new TypeError(
        `Duplicate code-splitter route ${JSON.stringify(route.path)} from ${
          JSON.stringify(existingFile)
        } and ${JSON.stringify(route.file)}`,
      );
    }

    const entryName = route.name ?? convertPathToName(route.path);
    assertEntryName(entryName, route.path);

    const existingRoute = entryRoute.get(entryName);
    if (existingRoute !== undefined) {
      throw new TypeError(
        `Code-splitter entry name ${JSON.stringify(entryName)} collides for routes ${
          JSON.stringify(existingRoute)
        } and ${JSON.stringify(route.path)}`,
      );
    }

    entryPoints[entryName] = route.file;
    routeMap.set(entryName, route.path);
    entryRoute.set(entryName, route.path);
    routeFiles.set(route.path, route.file);
  }

  return { entryPoints, routeMap };
}

export function convertPathToName(path: string): string {
  if (path === "/") return "index";
  return path.replace(/^\//, "").replaceAll("/", "-");
}
