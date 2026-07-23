import type { Route, RouteMatch } from "#veryfront/routing/matchers/types.ts";
import { getDisableLruIntervalEnv } from "#veryfront/config/env.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { parseRoute } from "#veryfront/routing/matchers/route-parser.ts";
import {
  matchRouteWithSpecificity,
  type RankedRouteMatch,
} from "#veryfront/routing/matchers/route-matcher.ts";
import { compareRouteSpecificity } from "#veryfront/utils/route-path-utils.ts";

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
    return this._routes;
  }

  addRoute(pattern: string, page: string): void {
    if (pattern !== "/" && pattern.endsWith("/")) {
      pattern = pattern.slice(0, -1);
    }

    const parsed = parseRoute(pattern, page);
    const route: Route = parsed;
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

  match(path: string): RouteMatch | null {
    const normalizedPath = this.normalizePathname(path);

    const cached = this.routeCache.get(normalizedPath);
    if (cached !== undefined) return cached;

    let best: RankedRouteMatch | null = null;
    let ambiguous = false;

    for (const routeData of this._routes.values()) {
      const candidate = matchRouteWithSpecificity(normalizedPath, routeData.route);
      if (!candidate) continue;

      const comparison = best
        ? compareRouteSpecificity(candidate.specificity, best.specificity)
        : 1;
      if (comparison > 0) {
        best = candidate;
        ambiguous = false;
      } else if (comparison === 0) {
        ambiguous = true;
      }
    }

    const result = !ambiguous && best ? best.match : null;
    this.routeCache.set(normalizedPath, result);
    return result;
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

function shouldDisableLruInterval(): boolean {
  if ((globalThis as Record<string, unknown>).__vfDisableLruInterval === true) return true;

  try {
    return getDisableLruIntervalEnv();
  } catch (_) {
    /* expected: env variable may not be available */
    return false;
  }
}
