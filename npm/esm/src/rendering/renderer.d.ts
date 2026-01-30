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
 *
 * ## Singleflight Deduplication
 *
 * Uses Singleflight to deduplicate concurrent renders of the same page.
 * Key insight: We cache the HTML string, not the stream. Each caller gets
 * a fresh RenderResult with the same HTML but no stream (streams can only
 * be consumed once). This prevents "body already consumed" errors while
 * still avoiding duplicate render work.
 *
 * The Singleflight key includes: projectId, environment, releaseId, slug, colorScheme
 */
export declare class Renderer {
    private cache;
    private initialized;
    private initializationPromise;
    /**
     * Singleflight for render deduplication. Caches HTML string results so
     * concurrent requests for the same page share the render work.
     * Key format: {projectId}:{environment}:{releaseId}:{slug}:{colorScheme}
     */
    private renderFlight;
    constructor(options?: RendererOptions);
    initialize(options?: SharedServicesOptions): Promise<void>;
    renderPage(slug: string, ctx: RenderContext, options?: RenderOptions): Promise<RenderResult>;
    /**
     * Build a Singleflight key for render deduplication.
     * Includes all context that affects rendering output.
     */
    private getSingleflightKey;
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