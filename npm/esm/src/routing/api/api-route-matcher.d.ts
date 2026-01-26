import type { Route, RouteMatch } from "../matchers/types.js";
export type { Route, RouteMatch };
/** Route entry with compiled regex and metadata */
export interface RouteEntry {
    regex: RegExp;
    route: Route;
    paramNames: string[];
    isOptionalCatchAll: boolean;
    isCatchAll: boolean;
}
export declare class DynamicRouter {
    private _routes;
    private routeCache;
    constructor();
    /** Public accessor for route entries */
    get routes(): Map<string, RouteEntry>;
    addRoute(pattern: string, page: string): void;
    private normalizePathname;
    private sortRoutesByPriority;
    match(path: string): RouteMatch | null;
    private extractParams;
    listRoutes(): Route[];
    clear(): void;
    clearCache(): void;
    destroy(): void;
}
//# sourceMappingURL=api-route-matcher.d.ts.map