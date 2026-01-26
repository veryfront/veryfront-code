/**
 * App Router Route Resolver
 *
 * Resolves App Router route files with support for dynamic segments,
 * catch-all routes, and optional catch-all routes.
 */
import type { HandlerContext } from "../../types.js";
import type { AppRouteMatch } from "./types.js";
export declare function resolveAppRouteFile(path: string, ctx: HandlerContext): Promise<AppRouteMatch | null>;
//# sourceMappingURL=app-router-resolver.d.ts.map