import type { Route, RouteMatch } from "./types.ts";
import { getSpecificityScore, parseRoute } from "./route-parser.ts";
import { matchRoute } from "./route-matcher.ts";
import { normalizePath } from "#veryfront/utils/path-utils.ts";

export class DynamicRouter {
  private routes: Route[] = [];
  private cache = new Map<string, RouteMatch | null>();

  addRoute(pattern: string, page: string): void {
    const route = parseRoute(pattern, page);
    this.routes.push(route);
    this.routes.sort((a, b) => {
      const aScore = getSpecificityScore(a);
      const bScore = getSpecificityScore(b);
      return bScore - aScore;
    });
  }

  match(pathname: string): RouteMatch | null {
    if (this.cache.has(pathname)) {
      return this.cache.get(pathname)!;
    }

    pathname = normalizePath(pathname);

    for (const route of this.routes) {
      const match = matchRoute(pathname, route);
      if (match) {
        this.cache.set(pathname, match);
        return match;
      }
    }

    this.cache.set(pathname, null);
    return null;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getRoutes(): Route[] {
    return [...this.routes];
  }
}
