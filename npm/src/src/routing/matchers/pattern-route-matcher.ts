import type { Route, RouteMatch } from "./types.js";
import { getSpecificityScore, parseRoute } from "./route-parser.js";
import { matchRoute } from "./route-matcher.js";
import { normalizePath } from "../../utils/path-utils.js";

export class DynamicRouter {
  private routes: Route[] = [];
  private cache = new Map<string, RouteMatch | null>();

  addRoute(pattern: string, page: string): void {
    const route = parseRoute(pattern, page);
    this.routes.push(route);
    this.routes.sort((a, b) => getSpecificityScore(b) - getSpecificityScore(a));
  }

  match(pathname: string): RouteMatch | null {
    const cached = this.cache.get(pathname);
    if (cached !== undefined) return cached;

    const normalizedPathname = normalizePath(pathname);

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
