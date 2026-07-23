/**
 * Entry point creation and path conversion utilities
 * @module code-splitter/entry-points
 */

import type { SplitOptions } from "./types.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

interface EntryPointsResult {
  entryPoints: Record<string, string>;
  routeMap: Map<string, string>;
}

export function assertValidRoutePath(path: unknown): asserts path is string {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError(`Invalid code-splitter route path: ${String(path)}`);
  }
  if (path === "/") return;
  if (
    path.endsWith("/") || path.includes("\\") || path.includes("?") || path.includes("#") ||
    hasUnsafeControlCharacters(path) ||
    path.slice(1).split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError(`Invalid code-splitter route path: ${path}`);
  }
}

export function createEntryPoints(
  routes: SplitOptions["routes"],
): EntryPointsResult {
  const entryPoints: Record<string, string> = Object.create(null);
  const routeMap = new Map<string, string>();
  const routePaths = new Set<string>();

  for (const route of routes) {
    if (!route || typeof route !== "object") {
      throw new TypeError("Code-splitter routes must contain route objects");
    }
    assertValidRoutePath(route.path);
    if (routePaths.has(route.path)) {
      throw new TypeError(`Duplicate code-splitter route path: ${route.path}`);
    }
    const entryName = route.name ?? convertPathToName(route.path);
    if (!/^[A-Za-z0-9_.[\]-]+$/.test(entryName) || entryName === "." || entryName === "..") {
      throw new TypeError(`Invalid code-splitter entry name: ${entryName}`);
    }
    if (Object.hasOwn(entryPoints, entryName)) {
      throw new TypeError(`Duplicate code-splitter entry name: ${entryName}`);
    }
    entryPoints[entryName] = route.file;
    routeMap.set(entryName, route.path);
    routePaths.add(route.path);
  }

  return { entryPoints, routeMap };
}

export function convertPathToName(path: string): string {
  if (path === "/") return "index";
  return path.replace(/^\//, "").replaceAll("/", "-");
}
