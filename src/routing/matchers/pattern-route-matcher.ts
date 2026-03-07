import type { Route, RouteMatch } from "./types.ts";
import { getSpecificityScore, parseRoute } from "./route-parser.ts";
import { matchRoute } from "./route-matcher.ts";
import { normalizePath } from "#veryfront/utils/path-utils.ts";

/**
 * Page route matcher for matching URL paths to page files.
 * Uses specificity-based sorting and shared route parsing utilities.
 * Suitable for page routing in both App Router and Pages Router.
 */
export class PageRouteMatcher {
  private routes: Route[] = [];
  private cache = new Map<string, RouteMatch | null>();

  addRoute(pattern: string, page: string): void {
    const route = parseRoute(pattern, page);
    this.routes.push(route);
    this.routes.sort((a, b) => getSpecificityScore(b) - getSpecificityScore(a));
  }

  match(pathname: string): RouteMatch | null {
    const normalizedPathname = normalizePath(pathname);

    const cached = this.cache.get(normalizedPathname);
    if (cached !== undefined) return cached;

    for (const route of this.routes) {
      const match = matchRoute(normalizedPathname, route);
      if (!match) continue;

      this.cache.set(normalizedPathname, match);
      return match;
    }

    this.cache.set(normalizedPathname, null);
    return null;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getRoutes(): Route[] {
    return [...this.routes];
  }
}
