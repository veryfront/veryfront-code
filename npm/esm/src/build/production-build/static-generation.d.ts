/**
 * Static Site Generation (SSG) for Build
 * Handles rendering pages to static HTML
 */
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { VeryfrontRenderer } from "../../rendering/orchestrator/ssr.js";
import type { VeryfrontConfig } from "../../config/index.js";
import type { ChunkManifest } from "../bundler/index.js";
import type { AppRouteInfo, RouteInfo } from "../../server/build-types.js";
export interface PageRenderResult {
    html: string;
    frontmatter?: Record<string, unknown>;
    headings?: Array<{
        level: number;
        text: string;
        id: string;
    }>;
    pageModule?: {
        slug: string;
        code: string;
        type: "mdx" | "component";
    };
    ssrHash?: string;
}
export interface SSGStats {
    pages: number;
    totalSize: number;
    ssgPaths: string[];
}
export interface SSGOptions {
    adapter: RuntimeAdapter;
    projectDir: string;
    outputDir: string;
    renderer: VeryfrontRenderer;
    config: VeryfrontConfig;
    enablePrefetch: boolean;
    chunkManifest: ChunkManifest | null;
    /** Content source identifier for cache isolation (defaults to "build-static" for static builds) */
    contentSourceId?: string;
    baseUrl?: string;
    dryRun?: boolean;
    traceStep?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}
export declare function buildPagesRoutes(routes: RouteInfo[], options: SSGOptions): Promise<SSGStats>;
export declare function buildAppRoutes(appRoutes: AppRouteInfo[], options: SSGOptions): Promise<SSGStats>;
//# sourceMappingURL=static-generation.d.ts.map