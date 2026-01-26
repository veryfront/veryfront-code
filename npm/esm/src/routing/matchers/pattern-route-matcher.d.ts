import type { Route, RouteMatch } from "./types.js";
export declare class DynamicRouter {
    private routes;
    private cache;
    addRoute(pattern: string, page: string): void;
    match(pathname: string): RouteMatch | null;
    clearCache(): void;
    getRoutes(): Route[];
}
//# sourceMappingURL=pattern-route-matcher.d.ts.map