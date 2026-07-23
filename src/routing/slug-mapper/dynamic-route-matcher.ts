import type { RouteParams } from "./types.ts";
import { extractParamsFromPattern } from "#veryfront/utils/route-path-utils.ts";
export { isDynamicRoute } from "#veryfront/utils/route-path-utils.ts";

export function extractParams(pattern: string, slug: string): RouteParams | null {
  return extractParamsFromPattern(pattern, slug) as RouteParams | null;
}

export function matchesPattern(pattern: string, slug: string): boolean {
  return extractParams(pattern, slug) !== null;
}
