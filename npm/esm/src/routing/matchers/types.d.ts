export interface RouteMatch {
    params: Record<string, string | string[]>;
    route: Route;
}
export interface Route {
    pattern: string;
    page: string;
    regex?: RegExp;
    paramNames?: string[];
    isCatchAll?: boolean;
    isOptionalCatchAll?: boolean;
}
//# sourceMappingURL=types.d.ts.map