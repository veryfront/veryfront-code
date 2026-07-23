import type { Route, RouteMatch } from "./types.ts";
import { compareRouteSpecificity as compareRouteDefinitions, parseRoute } from "./route-parser.ts";
import { matchRouteWithSpecificity, type RankedRouteMatch } from "./route-matcher.ts";
import { normalizePath } from "#veryfront/utils/path-utils.ts";
import { compareRouteSpecificity } from "#veryfront/utils/route-path-utils.ts";
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
    this.routes.sort((left, right) => compareRouteDefinitions(right, left));
    // A path may have been negatively cached (null / 404) before this route was
    // registered (dev hot-reload / late route discovery). Invalidate so the newly
    // added route becomes visible instead of the stale miss sticking forever.
    this.cache.clear();
  }

  match(pathname: string): RouteMatch | null {
    const normalizedPathname = normalizePath(pathname);

    const cached = this.cache.get(normalizedPathname);
    if (cached !== undefined) return cached;

    let best: RankedRouteMatch | null = null;
    let ambiguous = false;

    for (const route of this.routes) {
      const candidate = matchRouteWithSpecificity(normalizedPathname, route);
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
    this.cache.set(normalizedPathname, result);
    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getRoutes(): Route[] {
    return [...this.routes];
  }
}
