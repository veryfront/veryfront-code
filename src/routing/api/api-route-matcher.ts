import type { Route, RouteMatch } from "#veryfront/routing/matchers/types.ts";
import { getDisableLruIntervalEnv } from "#veryfront/config/env.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { safeDecodeParam } from "#veryfront/routing/matchers/decode-param.ts";
import { parseRoute } from "#veryfront/routing/matchers/route-parser.ts";
import { cloneRoute, cloneRouteMatch } from "#veryfront/routing/matchers/route-matcher.ts";

/** Max entries in the route-match LRU cache */
const ROUTE_CACHE_MAX_ENTRIES = 500;

/** Time-to-live for cached route matches (5 minutes) */
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1_000;

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
export class ApiRouteMatcher {
  private _routes: Map<string, RouteEntry> = new Map();
  private routeCache: LRUCache<string, RouteMatch | null>;

  constructor() {
    const disableIntervals = shouldDisableLruInterval();
    this.routeCache = new LRUCache<string, RouteMatch | null>({
      maxEntries: ROUTE_CACHE_MAX_ENTRIES,
      ttlMs: disableIntervals ? undefined : ROUTE_CACHE_TTL_MS,
    });
  }

  /** Public accessor for route entries */
  get routes(): Map<string, RouteEntry> {
    return new Map(
      Array.from(this._routes, ([pattern, entry]) => [
        pattern,
        {
          ...entry,
          regex: new RegExp(entry.regex.source, entry.regex.flags),
          route: cloneRoute(entry.route),
          paramNames: [...entry.paramNames],
        },
      ]),
    );
  }

  addRoute(pattern: string, page: string): void {
    if (pattern !== "/" && pattern.endsWith("/")) {
      pattern = pattern.slice(0, -1);
    }

    const parsed = parseRoute(pattern, page);
    const route: Route = { pattern, page };
    this._routes.set(pattern, {
      regex: parsed.regex!,
      route,
      paramNames: parsed.paramNames!,
      isOptionalCatchAll: parsed.isOptionalCatchAll!,
      isCatchAll: parsed.isCatchAll!,
    });

    // A path may have been negatively cached (null / 404) before this route was
    // registered (dev hot-reload / late route discovery). Invalidate so the newly
    // added route becomes visible instead of the stale miss sticking forever.
    this.routeCache.clear();
  }

  private normalizePathname(path: string): string {
    if (path === "/" || !path.endsWith("/")) return path;
    return path.slice(0, -1);
  }

  private sortRoutesByPriority(): Array<[string, RouteEntry]> {
    return Array.from(this._routes.entries()).sort(([, routeA], [, routeB]) => {
      const hasParamsA = routeA.paramNames.length > 0;
      const hasParamsB = routeB.paramNames.length > 0;
      const isCatchAllA = routeA.isCatchAll;
      const isCatchAllB = routeB.isCatchAll;

      if (!hasParamsA && hasParamsB) return -1;
      if (hasParamsA && !hasParamsB) return 1;
      if (!isCatchAllA && isCatchAllB) return -1;
      if (isCatchAllA && !isCatchAllB) return 1;

      return routeB.route.pattern.split("/").length - routeA.route.pattern.split("/").length;
    });
  }

  match(path: string): RouteMatch | null {
    const normalizedPath = this.normalizePathname(path);

    const cached = this.routeCache.get(normalizedPath);
    if (cached !== undefined) return cached ? cloneRouteMatch(cached) : null;

    for (const [, routeData] of this.sortRoutesByPriority()) {
      const match = normalizedPath.match(routeData.regex);
      if (!match) continue;

      const params = this.extractParams(match, routeData.paramNames, routeData.route);
      const result = { params, route: routeData.route };
      this.routeCache.set(normalizedPath, result);
      return cloneRouteMatch(result);
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
        setParam(params, paramName, segments.map((segment) => safeDecodeParam(segment)));
        continue;
      }

      setParam(params, paramName, safeDecodeParam(value ?? ""));
    }

    return params;
  }

  listRoutes(): Route[] {
    return Array.from(this._routes.values(), ({ route }) => cloneRoute(route));
  }

  clear(): void {
    this._routes.clear();
    this.routeCache.clear();
  }

  clearCache(): void {
    this.routeCache.clear();
  }

  destroy(): void {
    this._routes.clear();
    this.routeCache.destroy();
  }
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

function shouldDisableLruInterval(): boolean {
  if ((globalThis as Record<string, unknown>).__vfDisableLruInterval === true) return true;

  try {
    return getDisableLruIntervalEnv();
  } catch (_) {
    /* expected: env variable may not be available */
    return false;
  }
}
