/**
 * Route Collection and Discovery for Build
 */
import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { AppRouteInfo, RouteInfo } from "./build-types.js";
export declare function collectPagesRoutes(adapter: RuntimeAdapter, projectDir: string, include?: string[], exclude?: string[]): Promise<RouteInfo[]>;
/**
 * Collect App Router literal routes (static analyzable)
 */
export declare function collectAppRoutes(adapter: RuntimeAdapter, projectDir: string, include?: string[], exclude?: string[]): Promise<AppRouteInfo[]>;
//# sourceMappingURL=build-routes.d.ts.map