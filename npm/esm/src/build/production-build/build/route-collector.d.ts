/**
 * Route Collector Module
 *
 * Handles collection of routes from the project:
 * - Pages routes collection
 * - App routes collection
 * - Route filtering based on include/exclude patterns
 */
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { AppRouteInfo, RouteInfo } from "../../../server/build-types.js";
export interface CollectedRoutes {
    pages: RouteInfo[];
    app: AppRouteInfo[];
}
export declare function collectAllRoutes(adapter: RuntimeAdapter, projectDir: string, ssg: boolean, include?: string[], exclude?: string[]): Promise<CollectedRoutes>;
//# sourceMappingURL=route-collector.d.ts.map