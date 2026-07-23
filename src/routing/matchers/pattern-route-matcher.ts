import type { Route, RouteMatch } from "./types.ts";
import { getSpecificityScore, parseRoute } from "./route-parser.ts";
import { cloneRoute, cloneRouteMatch, matchRoute } from "./route-matcher.ts";
import { normalizePath } from "#veryfront/utils/path-utils.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";

/** Max entries in the route-match LRU cache */
const ROUTE_CACHE_MAX_ENTRIES = 500;

/**
 * Page route matcher for matching URL paths to page files.
 * Uses specificity-based sorting and shared route parsing utilities.
 * Suitable for page routing in both App Router and Pages Router.
 */
export class PageRouteMatcher {
  private routes: Route[] = [];
  // Bounded LRU (mirrors ApiRouteMatcher): an unbounded Map would grow without
  // limit under unique-URL traffic since every pathname — including 404s — is cached.
  private cache: LRUCache<string, RouteMatch | null>;

  constructor() {
    this.cache = new LRUCache<string, RouteMatch | null>({
      maxEntries: ROUTE_CACHE_MAX_ENTRIES,
    });
  }

  addRoute(pattern: string, page: string): void {
    const route = parseRoute(pattern, page);
    this.routes.push(route);
    this.routes.sort((a, b) => getSpecificityScore(b) - getSpecificityScore(a));
    // A path may have been negatively cached (null / 404) before this route was
    // registered (dev hot-reload / late route discovery). Invalidate so the newly
    // added route becomes visible instead of the stale miss sticking forever.
    this.cache.clear();
  }

  match(pathname: string): RouteMatch | null {
    const normalizedPathname = normalizePath(pathname);

    const cached = this.cache.get(normalizedPathname);
    if (cached !== undefined) return cached ? cloneRouteMatch(cached) : null;

    for (const route of this.routes) {
      const match = matchRoute(normalizedPathname, route);
      if (!match) continue;

      this.cache.set(normalizedPathname, match);
      return cloneRouteMatch(match);
    }

    this.cache.set(normalizedPathname, null);
    return null;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getRoutes(): Route[] {
    return this.routes.map(cloneRoute);
  }
}
