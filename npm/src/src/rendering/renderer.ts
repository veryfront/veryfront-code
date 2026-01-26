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
import * as dntShim from "../../_dnt.shims.js";


import { rendererLogger as logger } from "../utils/index.js";
import { MDXCacheAdapter } from "../transforms/mdx/index.js";
import { Semaphore } from "../modules/react-loader/ssr-module-loader/concurrency/semaphore.js";
import { ErrorCode, VeryfrontError } from "../errors/index.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
import {
  createRenderContext,
  createRenderContextFromEnriched,
  type CreateRenderContextOptions,
  type RenderContext,
} from "./context/render-context.js";
import {
  areSharedServicesInitialized,
  getSharedServices,
  initializeSharedServices,
  setSharedCompileMDX,
  type SharedServicesOptions,
} from "./shared/shared-services.js";
import {
  ContextAwareCacheCoordinator,
  type ContextAwareCacheOptions,
} from "./shared/context-aware-cache.js";
import {
  createComponentRegistry,
  createLayoutCollector,
  createLayoutCompiler,
  createPageRenderer,
  createPageResolver,
  createSSRRenderer,
  createVirtualModuleSystem,
} from "./factories/service-factories.js";
import { MDXCompiler } from "./orchestrator/mdx.js";
import { LayoutOrchestrator } from "./orchestrator/layout.js";
import { HTMLGenerator } from "./orchestrator/html.js";
import { SSROrchestrator } from "./orchestrator/ssr-orchestrator.js";
import { RenderPipeline } from "./orchestrator/pipeline.js";
import { createLayoutComponentCache } from "./layouts/utils/component-loader.js";
import type { PageDataResponse, RenderOptions, RenderResult } from "./orchestrator/types.js";
import type { HandlerContext } from "../server/handlers/types.js";
import { TimeoutError, withTimeoutThrow } from "./utils/stream-utils.js";

/**
 * Get environment variable (cross-platform: Deno, Node, Bun).
 */
function getEnv(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const g = dntShim.dntGlobalThis as any;
  return g.Deno?.env?.get(name) ?? g.process?.env?.[name];
}

// contentSourceId is computed by the proxy and validated in enriched-context.
// It's passed through the entire pipeline as ctx.contentSourceId.

/**
 * Master timeout for entire render pipeline (must be less than REQUEST_TIMEOUT_MS).
 * Configurable via RENDER_TIMEOUT_MS env var for cold-start scenarios.
 * Default increased to 60s to handle cold-start module transforms.
 */
const RENDER_PIPELINE_TIMEOUT_MS = parseInt(getEnv("RENDER_TIMEOUT_MS") ?? "60000", 10);

/**
 * Maximum concurrent renders per pod.
 * Configurable via RENDER_MAX_CONCURRENT env var.
 * Prevents one pod from being overwhelmed when multiple projects have issues.
 */
const RENDER_MAX_CONCURRENT = parseInt(getEnv("RENDER_MAX_CONCURRENT") ?? "30", 10);

/**
 * Timeout for acquiring render permit (ms).
 * If semaphore cannot be acquired within this time, request fails fast with 503.
 */
const RENDER_ACQUIRE_TIMEOUT_MS = 5000;

/**
 * Global render semaphore - limits concurrent renders across all projects per pod.
 * This is a last-line defense against resource exhaustion.
 */
const renderSemaphore = new Semaphore(RENDER_MAX_CONCURRENT);

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
export class Renderer {
  private cache: ContextAwareCacheCoordinator;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(options: RendererOptions = {}) {
    this.cache = new ContextAwareCacheCoordinator(options.cache);
  }

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

      await initializeSharedServices(options);

      this.initialized = true;
      logger.debug("[Renderer] Initialized", {
        duration: `${(performance.now() - startTime).toFixed(2)}ms`,
      });
    })();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  renderPage(slug: string, ctx: RenderContext, options?: RenderOptions): Promise<RenderResult> {
    return withSpan(
      "renderer.renderPage",
      async () => {
        if (!this.initialized) {
          throw new Error("Renderer not initialized. Call initialize() first.");
        }

        const startTime = performance.now();
        logger.debug("[Renderer] Rendering page", {
          slug,
          projectId: ctx.projectId,
          environment: ctx.environment,
        });

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

        const acquired = await renderSemaphore.tryAcquire(RENDER_ACQUIRE_TIMEOUT_MS);
        if (!acquired) {
          logger.error("[Renderer] Render capacity exceeded - service overloaded", {
            slug,
            projectId: ctx.projectId,
            waiting: renderSemaphore.waiting,
            available: renderSemaphore.available,
          });
          throw new VeryfrontError(
            `Render capacity exceeded (${renderSemaphore.waiting} waiting). Service is overloaded.`,
            ErrorCode.SERVICE_OVERLOADED,
            { slug, projectId: ctx.projectId, waiting: renderSemaphore.waiting },
          );
        }

        try {
          return await this.doRenderPage(slug, ctx, options, startTime);
        } finally {
          renderSemaphore.release();
        }
      },
      {
        "renderer.slug": slug,
        "renderer.projectId": ctx.projectId,
        "renderer.environment": ctx.environment,
      },
    );
  }

  private async doRenderPage(
    slug: string,
    ctx: RenderContext,
    options: RenderOptions | undefined,
    startTime: number,
  ): Promise<RenderResult> {
    const services = this.createServicesForContext(ctx, options?.colorScheme);
    const contentSourceId = ctx.contentSourceId;

    let result: RenderResult;
    try {
      result = await withTimeoutThrow(
        services.pipeline.renderPage(slug, {
          ...options,
          projectId: ctx.projectId,
          projectSlug: ctx.projectSlug,
          environment: ctx.environment,
          contentSourceId,
          skipCacheCheck: true,
        }),
        RENDER_PIPELINE_TIMEOUT_MS,
        `Render pipeline for ${ctx.projectId}:${slug}`,
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        logger.error("[Renderer] Render pipeline timeout - aborting", {
          slug,
          projectId: ctx.projectId,
          timeoutMs: RENDER_PIPELINE_TIMEOUT_MS,
        });
      }
      throw error;
    }

    await this.cache.persistResult(result, slug, ctx, options?.colorScheme);

    logger.debug("[Renderer] Render complete", {
      slug,
      projectId: ctx.projectId,
      duration: `${(performance.now() - startTime).toFixed(2)}ms`,
      htmlLength: result.html?.length ?? 0,
    });

    return result;
  }

  resolvePageData(
    slug: string,
    ctx: RenderContext,
    options?: RenderOptions,
  ): Promise<PageDataResponse> {
    if (!this.initialized) {
      throw new Error("Renderer not initialized. Call initialize() first.");
    }

    const contentSourceId = ctx.contentSourceId;
    const services = this.createServicesForContext(ctx);

    return services.pipeline.resolvePageData(slug, {
      ...options,
      projectId: ctx.projectId,
      projectSlug: ctx.projectSlug,
      environment: ctx.environment,
      contentSourceId,
    });
  }

  getAllPages(ctx: RenderContext): Promise<string[]> {
    if (!this.initialized) {
      throw new Error("Renderer not initialized. Call initialize() first.");
    }

    return createPageResolver(ctx).getAllPages();
  }

  async clearCache(ctx: RenderContext, slug?: string): Promise<void> {
    if (slug) {
      await this.cache.clearSlug(slug, ctx);
      return;
    }
    await this.cache.clearForContext(ctx);
  }

  /**
   * Clear all cached render results (across all contexts).
   * Called by poke/invalidation handlers to ensure fresh renders.
   * @deprecated Use clearCacheForProject for multi-tenant deployments
   */
  async clearAllCaches(): Promise<void> {
    logger.debug("[Renderer] Clearing ALL render caches (global)");
    await this.cache.clearAll();
  }

  async clearCacheForProject(projectId: string): Promise<void> {
    logger.debug("[Renderer] Clearing render cache for project", { projectId });
    await this.cache.clearForProject(projectId);
  }

  async destroy(): Promise<void> {
    await this.cache.destroy();
    this.initialized = false;
    logger.debug("[Renderer] Destroyed");
  }

  private createServicesForContext(
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
  ): {
    pipeline: RenderPipeline;
  } {
    const shared = getSharedServices();

    const mdxCacheAdapter = new MDXCacheAdapter({
      config: ctx.config,
      mode: ctx.mode,
    });

    const mdxCompiler = new MDXCompiler({
      projectDir: ctx.projectDir,
      mode: ctx.mode,
      mdxCacheAdapter,
    });

    const compileMDX = mdxCompiler.compileMDX.bind(mdxCompiler);
    setSharedCompileMDX(compileMDX);

    const virtualModules = createVirtualModuleSystem(ctx);
    const componentRegistry = createComponentRegistry(ctx, virtualModules);
    const pageResolver = createPageResolver(ctx);
    const layoutCollector = createLayoutCollector(ctx, compileMDX);
    const layoutCompiler = createLayoutCompiler(ctx, compileMDX);
    const ssrRenderer = createSSRRenderer(ctx);
    const pageRenderer = createPageRenderer(ctx, { componentRegistry, compileMDX });

    const layoutOrchestrator = new LayoutOrchestrator({
      projectDir: ctx.projectDir,
      projectId: ctx.projectId,
      projectSlug: ctx.projectSlug,
      contentSourceId: ctx.contentSourceId,
      adapter: ctx.adapter,
      config: ctx.config,
      mode: ctx.mode,
      moduleServerUrl: ctx.moduleServerUrl,
      layoutCollector,
      layoutCompiler,
      layoutCache: createLayoutComponentCache(),
      componentRegistry: componentRegistry.getAllAsComponents(),
    });

    const htmlGenerator = new HTMLGenerator({
      projectDir: ctx.projectDir,
      adapter: ctx.adapter,
      config: ctx.config,
      mode: ctx.mode,
    });

    const ssrOrchestrator = new SSROrchestrator({
      mode: ctx.mode,
      debugMode: ctx.mode === "development",
      elementValidator: shared.elementValidator,
      ssrRenderer,
      htmlGenerator,
    });

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

export {
  createRenderContext,
  createRenderContextFromEnriched,
  type CreateRenderContextOptions,
  type RenderContext,
};

let renderer: Renderer | null = null;

export function getRenderer(): Renderer {
  if (!renderer) {
    throw new Error("Renderer not initialized. Call initializeRenderer() first.");
  }
  return renderer;
}

export async function initializeRenderer(options?: RendererOptions): Promise<Renderer> {
  if (renderer) {
    return renderer;
  }

  renderer = new Renderer(options);
  await renderer.initialize(options?.shared);
  return renderer;
}

export function isRendererInitialized(): boolean {
  return renderer !== null && areSharedServicesInitialized();
}

export async function destroyRenderer(): Promise<void> {
  if (!renderer) {
    return;
  }
  await renderer.destroy();
  renderer = null;
}

/**
 * Clear all cached render results from the singleton renderer.
 * Safe to call even if renderer is not initialized (no-op).
 * @deprecated Use clearRendererCacheForProject for multi-tenant deployments
 */
export async function clearRendererCaches(): Promise<void> {
  logger.debug("[Renderer] clearRendererCaches called (global)", { hasRenderer: !!renderer });

  if (!renderer) {
    logger.debug("[Renderer] No renderer instance, skipping cache clear");
    return;
  }

  await renderer.clearAllCaches();
}

export async function clearRendererCacheForProject(projectId: string): Promise<void> {
  logger.debug("[Renderer] clearRendererCacheForProject called", {
    projectId,
    hasRenderer: !!renderer,
  });

  if (!renderer) {
    logger.debug("[Renderer] No renderer instance, skipping project cache clear", { projectId });
    return;
  }

  await renderer.clearCacheForProject(projectId);
}

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
