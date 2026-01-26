import { getSpecificityScore, parseRoute } from "./route-parser.js";
import { matchRoute } from "./route-matcher.js";
import { normalizePath } from "../../utils/path-utils.js";
export class DynamicRouter {
    routes = [];
    cache = new Map();
    addRoute(pattern, page) {
        const route = parseRoute(pattern, page);
        this.routes.push(route);
        this.routes.sort((a, b) => getSpecificityScore(b) - getSpecificityScore(a));
    }
    match(pathname) {
        const cached = this.cache.get(pathname);
        if (cached !== undefined)
            return cached;
        const normalizedPathname = normalizePath(pathname);
        for (const route of this.routes) {
            const match = matchRoute(normalizedPathname, route);
            if (!match)
                continue;
            this.cache.set(normalizedPathname, match);
            return match;
        }
        this.cache.set(normalizedPathname, null);
        return null;
    }
    clearCache() {
        this.cache.clear();
    }
    getRoutes() {
        return [...this.routes];
    }
}
