/**
 * Renderer
 *
 * A shared renderer that handles ANY project by injecting context at render time.
 * This eliminates the 7+ second cold start for new projects by sharing expensive
 * initialization (esbuild, MDX compiler) across all tenants.
 *
 * ## Architecture
 *
 * - **Shared Services** (initialized once, ~100ms):
 *   - ElementValidator - pure validation, no project state
 *   - CompilerService - late-binding MDX compilation
 *   - esbuild - already initialized by shared services
 *   - ContextAwareCacheCoordinator - cache with tenant-prefixed keys
 *
 * - **Per-Request Services** (created per-render, ~1ms):
 *   - PageResolver - needs projectDir, adapter, config
 *   - LayoutCollector - needs adapter, config
 *   - SSRRenderer - needs mode, adapter, projectDir
 *   - ComponentRegistry - needs projectId
 *   - etc.
 *
 * ## Tenant Isolation
 *
 * All tenant data is isolated through:
 * 1. Cache key prefixing (projectId:environment:releaseId:contentKey)
 * 2. Per-request service instances (no shared mutable state)
 * 3. RenderContext passed through the entire pipeline
 *
 * @module rendering/renderer
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { MDXCacheAdapter } from "#veryfront/transforms/mdx/index.ts";
import {
  createRenderContext,
  type CreateRenderContextOptions,
  type RenderContext,
} from "./context/render-context.ts";
import {
  areSharedServicesInitialized,
  getSharedServices,
  initializeSharedServices,
  setSharedCompileMDX,
  type SharedServicesOptions,
} from "./shared/shared-services.ts";
import {
  ContextAwareCacheCoordinator,
  type ContextAwareCacheOptions,
} from "./shared/context-aware-cache.ts";
import {
  createComponentRegistry,
  createLayoutCollector,
  createLayoutCompiler,
  createPageRenderer,
  createPageResolver,
  createSSRRenderer,
  createVirtualModuleSystem,
} from "./factories/service-factories.ts";
import { MDXCompiler } from "./orchestrator/mdx.ts";
import { LayoutOrchestrator } from "./orchestrator/layout.ts";
import { HTMLGenerator } from "./orchestrator/html.ts";
import { SSROrchestrator } from "./orchestrator/ssr-orchestrator.ts";
import { RenderPipeline } from "./orchestrator/pipeline.ts";
import { createLayoutComponentCache } from "./layouts/utils/component-loader.ts";
import type { PageDataResponse, RenderOptions, RenderResult } from "./orchestrator/types.ts";
import type { HandlerContext } from "../server/handlers/types.ts";

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
export class Renderer {
  private cache: ContextAwareCacheCoordinator;
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(options: RendererOptions = {}) {
    this.cache = new ContextAwareCacheCoordinator(options.cache);
  }

  /**
   * Initialize the renderer
   *
   * This must be called once at startup. It initializes shared services
   * like esbuild and the element validator. Takes ~100ms.
   *
   * @param options - Shared services options
   */
  async initialize(options?: SharedServicesOptions): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      const startTime = performance.now();
      logger.debug("[Renderer] Initializing...");

      // Initialize shared services (esbuild, element validator)
      await initializeSharedServices(options);

      this.initialized = true;
      const duration = performance.now() - startTime;
      logger.info("[Renderer] Initialized", {
        duration: `${duration.toFixed(2)}ms`,
      });
    })();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Render a page for a specific project
   *
   * Creates context-bound services for the request, then runs the
   * full rendering pipeline. Services are garbage collected after
   * the request completes.
   *
   * @param slug - Page slug to render
   * @param ctx - Render context with project info
   * @param options - Render options
   * @returns Render result with HTML, frontmatter, etc.
   */
  async renderPage(
    slug: string,
    ctx: RenderContext,
    options?: RenderOptions,
  ): Promise<RenderResult> {
    if (!this.initialized) {
      throw new Error("Renderer not initialized. Call initialize() first.");
    }

    const startTime = performance.now();
    logger.debug("[Renderer] Rendering page", {
      slug,
      projectId: ctx.projectId,
      environment: ctx.environment,
    });

    // Check cache first (context-aware, includes colorScheme in key)
    const cacheResult = await this.cache.checkCache(slug, ctx, options?.colorScheme);
    if (cacheResult.hit && cacheResult.cachedResult) {
      logger.debug("[Renderer] Cache hit", {
        slug,
        projectId: ctx.projectId,
        colorScheme: options?.colorScheme,
        duration: `${(performance.now() - startTime).toFixed(2)}ms`,
      });
      return cacheResult.cachedResult;
    }

    // Create context-bound services (lightweight, ~1ms)
    // Pass colorScheme so the pipeline cache also respects theme
    const services = this.createServicesForContext(ctx, options?.colorScheme);

    // Compute contentSourceId for cache isolation between preview/production
    const contentSourceId = ctx.environment === "production" && ctx.releaseId
      ? `release-${ctx.releaseId}`
      : `${ctx.environment}-draft`;

    // Run the render pipeline
    const result = await services.pipeline.renderPage(slug, {
      ...options,
      projectId: ctx.projectId,
      projectSlug: ctx.projectSlug,
      proxyEnvironment: ctx.environment,
      contentSourceId,
    });

    // Cache the result (context-aware, includes colorScheme in key)
    await this.cache.persistResult(result, slug, ctx, options?.colorScheme);

    const duration = performance.now() - startTime;
    logger.debug("[Renderer] Render complete", {
      slug,
      projectId: ctx.projectId,
      duration: `${duration.toFixed(2)}ms`,
      htmlLength: result.html?.length ?? 0,
    });

    return result;
  }

  /**
   * Resolve page data for SPA client-side navigation
   *
   * @param slug - Page slug
   * @param ctx - Render context
   * @param options - Render options
   * @returns Page data response
   */
  resolvePageData(
    slug: string,
    ctx: RenderContext,
    options?: RenderOptions,
  ): Promise<PageDataResponse> {
    if (!this.initialized) {
      throw new Error("Renderer not initialized. Call initialize() first.");
    }

    // Compute contentSourceId for cache isolation between preview/production
    const contentSourceId = ctx.environment === "production" && ctx.releaseId
      ? `release-${ctx.releaseId}`
      : `${ctx.environment}-draft`;

    const services = this.createServicesForContext(ctx);
    return services.pipeline.resolvePageData(slug, {
      ...options,
      projectId: ctx.projectId,
      projectSlug: ctx.projectSlug,
      proxyEnvironment: ctx.environment,
      contentSourceId,
    });
  }

  /**
   * Get all pages for a project
   *
   * @param ctx - Render context
   * @returns Array of page slugs
   */
  getAllPages(ctx: RenderContext): Promise<string[]> {
    if (!this.initialized) {
      throw new Error("Renderer not initialized. Call initialize() first.");
    }

    const pageResolver = createPageResolver(ctx);
    return pageResolver.getAllPages();
  }

  /**
   * Clear cache for a specific context
   *
   * @param ctx - Render context
   * @param slug - Optional specific slug to clear
   */
  async clearCache(ctx: RenderContext, slug?: string): Promise<void> {
    if (slug) {
      await this.cache.clearSlug(slug, ctx);
    } else {
      await this.cache.clearForContext(ctx);
    }
  }

  /**
   * Clear all cached render results (across all contexts).
   * Called by poke/invalidation handlers to ensure fresh renders.
   */
  async clearAllCaches(): Promise<void> {
    await this.cache.clearAll();
    logger.debug("[Renderer] All caches cleared");
  }

  /**
   * Destroy the renderer and clean up resources
   */
  async destroy(): Promise<void> {
    await this.cache.destroy();
    this.initialized = false;
    logger.debug("[Renderer] Destroyed");
  }

  /**
   * Create all services needed for rendering, bound to a specific context
   *
   * These services are lightweight to create (~1ms total) because
   * expensive initialization (esbuild, etc.) was done in shared services.
   *
   * @param ctx - Render context
   * @param colorScheme - Optional color scheme for cache key variation
   */
  private createServicesForContext(
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
  ): {
    pipeline: RenderPipeline;
  } {
    const shared = getSharedServices();

    // Create MDX cache adapter (content-hash keyed, safe to share pattern)
    const mdxCacheAdapter = new MDXCacheAdapter({
      config: ctx.config,
      mode: ctx.mode,
    });

    // Create MDX compiler for this context
    const mdxCompiler = new MDXCompiler({
      projectDir: ctx.projectDir,
      mode: ctx.mode,
      mdxCacheAdapter,
    });

    // Bind the MDX compile function
    const compileMDX = mdxCompiler.compileMDX.bind(mdxCompiler);

    // Set on shared compiler service for late-binding
    setSharedCompileMDX(compileMDX);

    // Create per-request services
    const virtualModules = createVirtualModuleSystem(ctx);
    const componentRegistry = createComponentRegistry(ctx, virtualModules);
    const pageResolver = createPageResolver(ctx);
    const layoutCollector = createLayoutCollector(ctx, compileMDX);
    const layoutCompiler = createLayoutCompiler(ctx, compileMDX);
    const ssrRenderer = createSSRRenderer(ctx);
    const pageRenderer = createPageRenderer(ctx, {
      componentRegistry,
      compileMDX,
    });

    // Create layout orchestrator
    // Compute contentSourceId for cache isolation between preview/production
    const contentSourceId = ctx.environment === "production" && ctx.releaseId
      ? `release-${ctx.releaseId}`
      : `${ctx.environment}-draft`;
    const layoutOrchestrator = new LayoutOrchestrator({
      projectDir: ctx.projectDir,
      projectId: ctx.projectId,
      projectSlug: ctx.projectSlug,
      contentSourceId,
      adapter: ctx.adapter,
      config: ctx.config,
      mode: ctx.mode,
      moduleServerUrl: ctx.moduleServerUrl,
      layoutCollector,
      layoutCompiler,
      layoutCache: createLayoutComponentCache(),
      componentRegistry: componentRegistry.getAllAsComponents(),
    });

    // Create HTML generator
    const htmlGenerator = new HTMLGenerator({
      projectDir: ctx.projectDir,
      adapter: ctx.adapter,
      config: ctx.config,
      mode: ctx.mode,
    });

    // Create SSR orchestrator
    const ssrOrchestrator = new SSROrchestrator({
      mode: ctx.mode,
      debugMode: ctx.mode === "development",
      elementValidator: shared.elementValidator,
      ssrRenderer,
      htmlGenerator,
    });

    // Create a simple cache coordinator wrapper for the pipeline
    // (The pipeline uses the old interface, we adapt to context-aware cache)
    // Include colorScheme in cache key to prevent serving wrong theme
    const pipelineCacheCoordinator = {
      checkCache: async (slug: string) => {
        const result = await this.cache.checkCache(slug, ctx, colorScheme);
        return {
          cachedResult: result.cachedResult,
          depAwareSlug: slug,
          moduleCacheKey: slug,
          cachedModule: result.cachedResult?.pageModule,
        };
      },
      persistResult: async (result: RenderResult, slug: string) => {
        await this.cache.persistResult(result, slug, ctx, colorScheme);
      },
      clearAll: () => this.cache.clearAll(),
      clearSlug: (slug: string) => this.cache.clearSlug(slug, ctx),
      destroy: () => this.cache.destroy(),
    };

    // Create render pipeline
    const pipeline = new RenderPipeline({
      pageResolver,
      cacheCoordinator: pipelineCacheCoordinator as any,
      pageRenderer,
      layoutOrchestrator,
      ssrOrchestrator,
      adapter: ctx.adapter,
      mode: ctx.mode,
      projectDir: ctx.projectDir,
    });

    return { pipeline };
  }
}

/**
 * Create a render context from handler context
 *
 * Convenience re-export for use in handlers.
 */
export { createRenderContext, type CreateRenderContextOptions, type RenderContext };

/**
 * Singleton renderer instance
 */
let renderer: Renderer | null = null;

/**
 * Get the singleton renderer
 *
 * @returns Renderer instance
 * @throws Error if not initialized
 */
export function getRenderer(): Renderer {
  if (!renderer) {
    throw new Error("Renderer not initialized. Call initializeRenderer() first.");
  }
  return renderer;
}

/**
 * Initialize the singleton renderer
 *
 * @param options - Renderer options
 * @returns Initialized renderer
 */
export async function initializeRenderer(options?: RendererOptions): Promise<Renderer> {
  if (renderer) {
    return renderer;
  }

  renderer = new Renderer(options);
  await renderer.initialize(options?.shared);
  return renderer;
}

/**
 * Check if the renderer is initialized
 */
export function isRendererInitialized(): boolean {
  return renderer !== null && areSharedServicesInitialized();
}

/**
 * Destroy the singleton renderer
 */
export async function destroyRenderer(): Promise<void> {
  if (renderer) {
    await renderer.destroy();
    renderer = null;
  }
}

/**
 * Clear all cached render results from the singleton renderer.
 * Safe to call even if renderer is not initialized (no-op).
 */
export function clearRendererCaches(): void {
  if (renderer) {
    renderer.clearAllCaches().catch((err) => {
      logger.warn("[Renderer] Failed to clear caches", { error: String(err) });
    });
  }
}

/**
 * Render a page using the renderer
 *
 * Convenience function that creates a render context from handler context
 * and renders the page.
 *
 * @param slug - Page slug
 * @param handlerCtx - Handler context
 * @param options - Render options
 * @param contextOptions - Context creation options
 * @returns Render result
 */
export function renderPage(
  slug: string,
  handlerCtx: HandlerContext,
  options?: RenderOptions,
  contextOptions?: CreateRenderContextOptions,
): Promise<RenderResult> {
  const r = getRenderer();
  const ctx = createRenderContext(handlerCtx, contextOptions);
  return r.renderPage(slug, ctx, options);
}
