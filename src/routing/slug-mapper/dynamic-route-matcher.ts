import { extractParamsFromPattern } from "#veryfront/utils/route-path-utils.ts";
import type { RouteParams } from "./types.ts";

export { isDynamicRoute, matchesPattern } from "#veryfront/utils/route-path-utils.ts";

/** Delegate parameter extraction to the shared canonical route matcher. */
export function extractParams(pattern: string, slug: string): RouteParams | null {
  return extractParamsFromPattern(pattern, slug);
}
