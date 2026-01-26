/**
 * Build Executor Module
 *
 * Handles the execution of the actual build process:
 * - Building pages routes
 * - Building app routes
 * - Coordinating SSG options
 * - Aggregating build statistics
 */
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../../config/index.js";
import type { VeryfrontRenderer } from "../../../rendering/index.js";
import type { AppRouteInfo, RouteInfo } from "../../../server/build-types.js";
import type { ChunkManifest } from "../../bundler/index.js";
export interface BuildExecutorOptions {
    adapter: RuntimeAdapter;
    projectDir: string;
    outputDir: string;
    renderer: VeryfrontRenderer;
    config: VeryfrontConfig;
    enablePrefetch: boolean;
    chunkManifest: ChunkManifest | null;
    baseUrl: string;
    dryRun: boolean;
}
export interface BuildResult {
    pages: number;
    totalSize: number;
    ssgPaths: string[];
}
/**
 * Execute the build process for all routes
 */
export declare function executeBuild(pagesRoutes: RouteInfo[], appRoutes: AppRouteInfo[], options: BuildExecutorOptions): Promise<BuildResult>;
//# sourceMappingURL=build-executor.d.ts.map