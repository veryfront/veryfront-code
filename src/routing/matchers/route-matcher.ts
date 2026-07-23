import type { Route, RouteMatch } from "./types.ts";
import { safeDecodeParam } from "./decode-param.ts";
import {
  compileRoutePattern,
  extractRoutePatternMatch,
  type RouteSpecificity,
} from "#veryfront/utils/route-path-utils.ts";

function decodeCatchAllValue(value?: string): string[] {
  if (!value) return [];

  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => safeDecodeParam(segment));
}

export function matchRoute(pathname: string, route: Route): RouteMatch | null {
  return matchRouteWithSpecificity(pathname, route)?.match ?? null;
}

export interface RankedRouteMatch {
  match: RouteMatch;
  specificity: RouteSpecificity;
}

/** Match a route and retain the structural rank used by route collections. */
export function matchRouteWithSpecificity(
  pathname: string,
  route: Route,
): RankedRouteMatch | null {
  const compiled = compileRoutePattern(route.pattern);
  if (!compiled.valid) return null;

  const match = pathname.match(route.regex ?? compiled.regex);
  if (!match) return null;

  const patternMatch = extractRoutePatternMatch(compiled, match);
  const params: Record<string, string | string[]> = {};

  for (const [index, parameter] of compiled.parameters.entries()) {
    const name = parameter.name;
    const value = match[index + 1] ?? "";
    const decoded = parameter.kind !== "dynamic"
      ? decodeCatchAllValue(value)
      : safeDecodeParam(value);
    Object.defineProperty(params, name, {
      value: decoded,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return {
    match: { params, route },
    specificity: patternMatch.specificity,
  };
}
