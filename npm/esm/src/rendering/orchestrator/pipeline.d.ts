/**
 * Render Pipeline
 *
 * Orchestrates the complete page rendering process through 10 stages:
 * 1. Page Resolution - 2. Layout/Provider Collection - 3. Speculative Cache Check (parallel)
 * 4. Route Params - 5. Two-Phase Data Fetching - 6. Await Cache Check
 * 7. Bundle Preparation - 8. Layout Application - 9. SSR Rendering - 10. Result Assembly
 *
 * Performance optimizations:
 * - Speculative cache check runs in parallel with data fetching
 * - Two-phase data fetching: load all modules first, then fetch all data in parallel
 * - Supports both /pages/ and /app/ router directories
 *
 * @module rendering/orchestrator/pipeline
 */
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { CacheCoordinator } from "../cache/cache-coordinator.js";
import type { PageRenderer } from "../page-renderer.js";
import type { PageResolver } from "../page-resolution/index.js";
import type { LayoutOrchestrator } from "./layout.js";
import type { SSROrchestrator } from "./ssr-orchestrator.js";
import type { PageDataResponse, RenderOptions, RenderResult } from "./types.js";
export interface RenderPipelineConfig {
    pageResolver: PageResolver;
    cacheCoordinator: CacheCoordinator;
    pageRenderer: PageRenderer;
    layoutOrchestrator: LayoutOrchestrator;
    ssrOrchestrator: SSROrchestrator;
    adapter: RuntimeAdapter;
    mode: "development" | "production";
    projectDir: string;
}
/**
 * Orchestrates the complete page rendering process through 10 stages:
 * 1. Page Resolution - 2. Layout/Provider Collection - 3. Speculative Cache Check
 * 4. Route Params - 5. Two-Phase Data Fetching - 6. Await Cache Check
 * 7. Bundle Preparation - 8. Layout Application - 9. SSR Rendering - 10. Result Assembly
 */
export declare class RenderPipeline {
    private config;
    private dataFetcher;
    private moduleLoaderConfig;
    constructor(config: RenderPipelineConfig);
    /**
     * Clear the module cache to force re-transformation on next render.
     * Called by poke/invalidation handlers to ensure fresh modules are loaded.
     */
    clearModuleCache(): void;
    private loadModule;
    /**
     * Collect modules that need data fetching from page and layouts.
     */
    private collectModulesToLoad;
    /**
     * Load modules in parallel and return only successfully loaded ones.
     *
     * IMPORTANT: Page modules are considered critical - if a page module fails to load,
     * we throw an error instead of silently continuing with missing props. This prevents
     * users from seeing broken pages with no indication of the problem.
     *
     * Layout modules are considered non-critical - their failures are logged as warnings
     * and the page continues to render (possibly without that layout's data).
     */
    private loadModulesInParallel;
    /**
     * Check if module has data fetching function (getServerData or getStaticData).
     */
    private hasDataFetchingFunction;
    renderPage(slug: string, options?: RenderOptions): Promise<RenderResult>;
    /** Resolve page data for SPA client-side navigation without rendering HTML. */
    resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse>;
}
//# sourceMappingURL=pipeline.d.ts.map