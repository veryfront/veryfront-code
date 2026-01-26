import type { RouteParams } from "./types.js";
export declare function isDynamicRoute(pattern: string): boolean;
export declare function extractParams(pattern: string, slug: string): RouteParams | null;
export declare function matchesPattern(pattern: string, slug: string): boolean;
//# sourceMappingURL=dynamic-route-matcher.d.ts.map