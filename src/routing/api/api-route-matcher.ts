import type { Route, RouteMatch } from "#veryfront/routing/matchers/types.ts";
import { getDisableLruIntervalEnv } from "#veryfront/config/env.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";

export type { Route, RouteMatch };

/** Route entry with compiled regex and metadata */
export interface RouteEntry {
  regex: RegExp;
  route: Route;
  paramNames: string[];
  isOptionalCatchAll: boolean;
  isCatchAll: boolean;
}

/**
 * API route matcher for matching URL paths to API route handlers.
 * Uses LRU caching for performance and self-contained regex compilation.
 * Suitable for API routes in /api/* and /app/api/* paths.
 */
export class APIRouteMatcher {
  private _routes: Map<string, RouteEntry> = new Map();
  private routeCache: LRUCache<string, RouteMatch | null>;

  constructor() {
    const disableIntervals = shouldDisableLruInterval();
    this.routeCache = new LRUCache<string, RouteMatch | null>({
      maxEntries: 500,
      ttlMs: disableIntervals ? undefined : 5 * 60 * 1000,
    });
  }

  /** Public accessor for route entries */
  get routes(): Map<string, RouteEntry> {
    return this._routes;
  }

  addRoute(pattern: string, page: string): void {
    const originalPattern = pattern;
    let regex = pattern;
    let isOptionalCatchAll = false;
    let isCatchAll = false;

    const paramNames: string[] = [];
    for (
      const match of originalPattern.matchAll(/\[\[\.\.\.(\w+)\]\]|\[\.\.\.(\w+)\]|\[(\w+)\]/g)
    ) {
      const optionalCatchAll = match[1];
      const catchAll = match[2];
      const param = match[3];

      if (optionalCatchAll) {
        paramNames.push(optionalCatchAll);
        isOptionalCatchAll = true;
        isCatchAll = true;
        continue;
      }

      if (catchAll) {
        paramNames.push(catchAll);
        isCatchAll = true;
        continue;
      }

      if (param) paramNames.push(param);
    }

    regex = regex
      .replace(/\/?\[\[\.\.\.([^\]]+)\]\]/g, "(?:/(.+))?")
      .replace(/\[\.\.\.([^\]]+)\]/g, "(.+)")
      .replace(/\[([^\]]+)\]/g, "([^/]+)");

    if (pattern !== "/" && pattern.endsWith("/")) {
      pattern = pattern.slice(0, -1);
      if (regex.endsWith("/")) regex = regex.slice(0, -1);
    }

    const route: Route = { pattern, page };
    this._routes.set(pattern, {
      regex: new RegExp(`^${regex}$`),
      route,
      paramNames,
      isOptionalCatchAll,
      isCatchAll,
    });
  }

  private normalizePathname(path: string): string {
    if (path === "/" || !path.endsWith("/")) return path;
    return path.slice(0, -1);
  }

  private sortRoutesByPriority(): Array<[string, RouteEntry]> {
    return Array.from(this._routes.entries()).sort(([patternA], [patternB]) => {
      const hasParamsA = patternA.includes("[");
      const hasParamsB = patternB.includes("[");
      const isCatchAllA = patternA.includes("[...");
      const isCatchAllB = patternB.includes("[...");

      if (!hasParamsA && hasParamsB) return -1;
      if (hasParamsA && !hasParamsB) return 1;
      if (!isCatchAllA && isCatchAllB) return -1;
      if (isCatchAllA && !isCatchAllB) return 1;

      return patternB.split("/").length - patternA.split("/").length;
    });
  }

  match(path: string): RouteMatch | null {
    const normalizedPath = this.normalizePathname(path);

    const cached = this.routeCache.get(normalizedPath);
    if (cached !== undefined) return cached;

    for (const [, routeData] of this.sortRoutesByPriority()) {
      const match = normalizedPath.match(routeData.regex);
      if (!match) continue;

      const params = this.extractParams(match, routeData.paramNames, routeData.route);
      const result = { params, route: routeData.route };
      this.routeCache.set(normalizedPath, result);
      return result;
    }

    this.routeCache.set(normalizedPath, null);
    return null;
  }

  private extractParams(
    match: RegExpMatchArray,
    paramNames: string[],
    route: Route,
  ): Record<string, string | string[]> {
    const params: Record<string, string | string[]> = {};
    const catchAllParamNames = new Set<string>();

    route.pattern.replace(/\[\[\.\.\.(\w+)\]\]/g, (_: string, paramName: string) => {
      catchAllParamNames.add(paramName);
      return "";
    });
    route.pattern.replace(/\[\.\.\.(\w+)\]/g, (_: string, paramName: string) => {
      catchAllParamNames.add(paramName);
      return "";
    });

    for (let i = 0; i < paramNames.length; i++) {
      const paramName = paramNames[i]!;
      const value = match[i + 1];

      if (catchAllParamNames.has(paramName)) {
        const segments = value ? value.split("/").filter((segment) => segment.length > 0) : [];
        params[paramName] = segments.map((segment) => decodeURIComponent(segment));
        continue;
      }

      params[paramName] = decodeURIComponent(value ?? "");
    }

    return params;
  }

  listRoutes(): Route[] {
    return Array.from(this._routes.values()).map(({ route }) => route);
  }

  clear(): void {
    this._routes.clear();
    this.routeCache.destroy();
  }

  clearCache(): void {
    this.routeCache.clear();
  }

  destroy(): void {
    this.clear();
  }
}

/** @deprecated Use APIRouteMatcher instead - kept for backwards compatibility */
export { APIRouteMatcher as DynamicRouter };

function shouldDisableLruInterval(): boolean {
  if ((globalThis as Record<string, unknown>).__vfDisableLruInterval === true) return true;

  try {
    return getDisableLruIntervalEnv();
  } catch {
    return false;
  }
}
