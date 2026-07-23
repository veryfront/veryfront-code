import type { Route, RouteMatch } from "./types.ts";
import { safeDecodeParam } from "./decode-param.ts";

const CATCH_ALL_PATTERN = /\[\[?\.\.\.(\w+)\]\]?/g;

function extractCatchAllParams(pattern?: string): Set<string> {
  const params = new Set<string>();
  if (!pattern) return params;

  for (const match of pattern.matchAll(CATCH_ALL_PATTERN)) {
    const name = match[1];
    if (name) params.add(name);
  }

  return params;
}

function decodeCatchAllValue(value?: string): string[] {
  if (!value) return [];

  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => safeDecodeParam(segment));
}

function setParam(
  params: Record<string, string | string[]>,
  name: string,
  value: string | string[],
): void {
  Object.defineProperty(params, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

export function cloneRoute(route: Route): Route {
  return {
    ...route,
    regex: route.regex ? new RegExp(route.regex.source, route.regex.flags) : undefined,
    paramNames: route.paramNames ? [...route.paramNames] : undefined,
  };
}

export function cloneRouteMatch(match: RouteMatch): RouteMatch {
  const params: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(match.params)) {
    setParam(params, name, Array.isArray(value) ? [...value] : value);
  }
  return { params, route: cloneRoute(match.route) };
}

export function matchRoute(pathname: string, route: Route): RouteMatch | null {
  const match = pathname.match(route.regex!);
  if (!match) return null;

  const catchAllParams = extractCatchAllParams(route.pattern);
  const params: Record<string, string | string[]> = {};

  for (const [index, name] of (route.paramNames ?? []).entries()) {
    const value = match[index + 1] ?? "";
    setParam(
      params,
      name,
      catchAllParams.has(name) ? decodeCatchAllValue(value) : safeDecodeParam(value),
    );
  }

  return { params, route };
}
