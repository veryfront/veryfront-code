import { createRenderContext, createRenderContextFromEnriched, type CreateRenderContextOptions, type RenderContext } from "./context/render-context.js";
import { type SharedServicesOptions } from "./shared/shared-services.js";
import { type ContextAwareCacheOptions } from "./shared/context-aware-cache.js";
import type { PageDataResponse, RenderOptions, RenderResult } from "./orchestrator/types.js";
import type { HandlerContext } from "../server/handlers/types.js";
/**
 * Options for initializing the Renderer
 */
export interface RendererOptions {
    /** Shared services options */
    shared?: SharedServicesOptions;
    /** Cache options */
    cache?: ContextAwareCacheOptions;
}
/**
 * Renderer - Shared renderer for all projects
 *
 * Initialize once at startup, then use for any project by passing
 * a RenderContext to each render call.
 */
/**
 * Note: Singleflight was previously used for render deduplication but caused
 * "body already consumed" errors when multiple concurrent requests shared the
 * same RenderResult. The RenderResult.stream is a ReadableStream that can only
 * be consumed once. Without Singleflight, concurrent requests for the same page
 * may duplicate work, but this is acceptable since:
 * 1. The cache (checkCache) handles repeated requests after first render completes
 * 2. Duplicate renders are rare in practice and don't cause errors
 * 3. This matches the pattern in http-cache.ts which also removed Singleflight
 */
export declare class Renderer {
    private cache;
    private initialized;
    private initializationPromise;
    constructor(options?: RendererOptions);
    initialize(options?: SharedServicesOptions): Promise<void>;
    renderPage(slug: string, ctx: RenderContext, options?: RenderOptions): Promise<RenderResult>;
    private doRenderPage;
    resolvePageData(slug: string, ctx: RenderContext, options?: RenderOptions): Promise<PageDataResponse>;
    getAllPages(ctx: RenderContext): Promise<string[]>;
    clearCache(ctx: RenderContext, slug?: string): Promise<void>;
    /**
     * Clear all cached render results (across all contexts).
     * Called by poke/invalidation handlers to ensure fresh renders.
     * @deprecated Use clearCacheForProject for multi-tenant deployments
     */
    clearAllCaches(): Promise<void>;
    clearCacheForProject(projectId: string): Promise<void>;
    destroy(): Promise<void>;
    private createServicesForContext;
}
export { createRenderContext, createRenderContextFromEnriched, type CreateRenderContextOptions, type RenderContext, };
export declare function getRenderer(): Renderer;
export declare function initializeRenderer(options?: RendererOptions): Promise<Renderer>;
export declare function isRendererInitialized(): boolean;
export declare function destroyRenderer(): Promise<void>;
/**
 * Clear all cached render results from the singleton renderer.
 * Safe to call even if renderer is not initialized (no-op).
 * @deprecated Use clearRendererCacheForProject for multi-tenant deployments
 */
export declare function clearRendererCaches(): Promise<void>;
export declare function clearRendererCacheForProject(projectId: string): Promise<void>;
export declare function renderPage(slug: string, handlerCtx: HandlerContext, options?: RenderOptions, contextOptions?: CreateRenderContextOptions): Promise<RenderResult>;
//# sourceMappingURL=renderer.d.ts.map