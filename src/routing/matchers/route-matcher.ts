import type { Route, RouteMatch } from "./types.ts";

/** Pattern to match catch-all route segments like [...slug] or [[...slug]] */
const CATCH_ALL_PATTERN = /\[\[?\.\.\.(\w+)\]\]?/g;

/** Extracts catch-all parameter names from a route pattern */
function extractCatchAllParams(pattern: string | undefined): Set<string> {
  const catchAllParams = new Set<string>();
  if (!pattern) return catchAllParams;

  for (const match of pattern.matchAll(CATCH_ALL_PATTERN)) {
    if (match[1]) catchAllParams.add(match[1]);
  }
  return catchAllParams;
}

/** Decodes and splits a catch-all value into segments */
function decodeCatchAllValue(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}

export function matchRoute(pathname: string, route: Route): RouteMatch | null {
  const match = pathname.match(route.regex!);
  if (!match) return null;

  const catchAllParams = extractCatchAllParams(route.pattern);
  const params: Record<string, string | string[]> = {};

  for (const [index, name] of (route.paramNames ?? []).entries()) {
    const value = match[index + 1];
    params[name] = catchAllParams.has(name)
      ? decodeCatchAllValue(value)
      : decodeURIComponent(value || "");
  }

  return { params, route };
}
