/**
 * Routing Matchers
 *
 * @module routing/matchers
 */

export type { Route, RouteMatch } from "./types.ts";
export { PageRouteMatcher } from "./pattern-route-matcher.ts";
export { getSpecificityScore, parseRoute } from "./route-parser.ts";
export { matchRoute } from "./route-matcher.ts";
export { normalizePath } from "#veryfront/utils";
