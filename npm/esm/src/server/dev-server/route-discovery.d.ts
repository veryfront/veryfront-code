import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { DynamicRouter } from "../../routing/api/index.js";
import type { VeryfrontConfig } from "../../config/index.js";
export declare class RouteDiscovery {
    private projectDir;
    private adapter;
    private router;
    private config?;
    private useRelativePaths;
    constructor(projectDir: string, adapter: RuntimeAdapter, router: DynamicRouter, config?: VeryfrontConfig | undefined);
    discoverRoutes(): Promise<void>;
    private resolveRouteDirectories;
    private directoryExists;
    private discoverPagesRoutes;
    private discoverAppRoutes;
    private discoverAppRoutesRecursive;
    private normalizeAppPathSegment;
    private buildAppRoutePattern;
    private toProjectRelativePath;
}
//# sourceMappingURL=route-discovery.d.ts.map