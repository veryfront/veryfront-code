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
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import { ErrorCode, VeryfrontError } from "#veryfront/errors/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  createRenderContext,
  createRenderContextFromEnriched,
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
import { TimeoutError, withTimeoutThrow } from "./utils/stream-utils.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";

/**
 * Get environment variable (cross-platform: Deno, Node, Bun).
 */
function getEnv(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  return g.Deno?.env?.get(name) ?? g.process?.env?.[name];
}

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
 * Maximum concurrent renders per project (noisy-neighbor protection).
 * Defaults to ceil(RENDER_MAX_CONCURRENT / 3) so no single project can consume
 * more than ~1/3 of pod capacity. Set to 0 to disable per-project limits.
 * Configurable via RENDER_PER_PROJECT_LIMIT env var.
 */
const RENDER_PER_PROJECT_LIMIT = parseInt(
  getEnv("RENDER_PER_PROJECT_LIMIT") ?? String(Math.ceil(RENDER_MAX_CONCURRENT / 3)),
  10,
);

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
 * Per-project active render counter. Prevents a single noisy tenant from
 * monopolizing the global semaphore and starving other projects.
 * Only enforced when RENDER_PER_PROJECT_LIMIT > 0.
 */
const projectRenderCounts = new Map<string, number>();

/**
 * Lock map to prevent race conditions in acquireProjectSlot/releaseProjectSlot.
 * Each project has its own lock to allow concurrent access across different projects
 * while serializing access within the same project.
 *
 * The race condition: Without locking, concurrent requests can read the same count,
 * both pass the limit check, and both increment - allowing 2*limit concurrent renders.
 */
const projectSlotLocks = new Map<string, Promise<void>>();

/** Maximum time to wait for a lock before giving up (10 seconds) */
const LOCK_TIMEOUT_MS = 10_000;

/**
 * Acquire a lock for a specific project. Returns a release function.
 * Uses a retry loop to ensure atomicity - avoids TOCTOU race conditions.
 */
async function acquireProjectLock(projectId: string): Promise<() => void> {
  const startTime = Date.now();

  while (true) {
    if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
      throw new Error(`Lock acquisition timeout for project: ${projectId}`);
    }

    const existingLock = projectSlotLocks.get(projectId);
    if (existingLock) {
      await existingLock;
      continue;
    }

    let releaseLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    if (projectSlotLocks.has(projectId)) {
      continue;
    }

    projectSlotLocks.set(projectId, lockPromise);

    return () => {
      releaseLock();
      if (projectSlotLocks.get(projectId) === lockPromise) {
        projectSlotLocks.delete(projectId);
      }
    };
  }
}

/**
 * Attempt to acquire a project render slot with proper locking.
 * Returns true if acquired, false if limit reached.
 */
async function acquireProjectSlot(projectId: string): Promise<boolean> {
  if (RENDER_PER_PROJECT_LIMIT <= 0) return true;

  const release = await acquireProjectLock(projectId);
  try {
    const current = projectRenderCounts.get(projectId) ?? 0;
    if (current >= RENDER_PER_PROJECT_LIMIT) return false;

    projectRenderCounts.set(projectId, current + 1);
    return true;
  } finally {
    release();
  }
}

/**
 * Release a project render slot with proper locking.
 */
async function releaseProjectSlot(projectId: string): Promise<void> {
  if (RENDER_PER_PROJECT_LIMIT <= 0) return;

  const release = await acquireProjectLock(projectId);
  try {
    const current = projectRenderCounts.get(projectId) ?? 0;
    if (current <= 1) {
      projectRenderCounts.delete(projectId);
      return;
    }
    projectRenderCounts.set(projectId, current - 1);
  } finally {
    release();
  }
}

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
 * Cached render result for Singleflight deduplication.
 * Contains only the serializable parts of RenderResult (no stream).
 * Each caller gets a fresh RenderResult from this cached data.
 */
interface CachedRenderData {
  html: string;
  frontmatter: RenderResult["frontmatter"];
  headings?: RenderResult["headings"];
  ssrHash?: string;
  pageModule?: RenderResult["pageModule"];
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
export class Renderer {
  private cache: ContextAwareCacheCoordinator;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Singleflight for render deduplication. Caches HTML string results so
   * concurrent requests for the same page share the render work.
   * Key format: {projectId}:{environment}:{releaseId}:{slug}:{colorScheme}
   */
  private renderFlight = new Singleflight<CachedRenderData>();

  constructor(options: RendererOptions = {}) {
    this.cache = new ContextAwareCacheCoordinator(options.cache);
  }

  async initialize(options?: SharedServicesOptions): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;

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

        const cacheKey = this.buildCacheKey(slug, options);
        const cacheResult = cacheKey
          ? await this.cache.checkCache(slug, ctx, options?.colorScheme, cacheKey)
          : { hit: false, cacheKey: "" };
        if (cacheResult.hit && cacheResult.cachedResult) {
          logger.debug("[Renderer] Cache hit", {
            slug,
            projectId: ctx.projectId,
            colorScheme: options?.colorScheme,
            duration: `${(performance.now() - startTime).toFixed(2)}ms`,
          });
          return cacheResult.cachedResult;
        }

        if (!(await acquireProjectSlot(ctx.projectId))) {
          const activeCount = projectRenderCounts.get(ctx.projectId) ?? 0;
          logger.error("[Renderer] Per-project render limit reached", {
            slug,
            projectId: ctx.projectId,
            activeRenders: activeCount,
            limit: RENDER_PER_PROJECT_LIMIT,
          });
          throw new VeryfrontError(
            `Per-project render limit reached (${activeCount}/${RENDER_PER_PROJECT_LIMIT} active). Try again shortly.`,
            ErrorCode.SERVICE_OVERLOADED,
            {
              slug,
              projectId: ctx.projectId,
              activeRenders: activeCount,
              limit: RENDER_PER_PROJECT_LIMIT,
            },
          );
        }

        const acquired = await renderSemaphore.tryAcquire(RENDER_ACQUIRE_TIMEOUT_MS);
        if (!acquired) {
          await releaseProjectSlot(ctx.projectId);
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
          return await this.doRenderPage(slug, ctx, options, startTime, cacheKey);
        } finally {
          renderSemaphore.release();
          await releaseProjectSlot(ctx.projectId);
        }
      },
      {
        "renderer.slug": slug,
        "renderer.projectId": ctx.projectId,
        "renderer.environment": ctx.environment,
      },
    );
  }

  /**
   * Build a Singleflight key for render deduplication.
   * Includes all context that affects rendering output.
   */
  private getSingleflightKey(
    slug: string,
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
  ): string {
    return `${ctx.projectId}:${ctx.environment}:${ctx.contentSourceId ?? "draft"}:${slug}:${
      colorScheme ?? "default"
    }`;
  }

  /**
   * Compute a cache key that is query-aware and avoids caching personalized responses
   * (Authorization / Cookie / x-api-key) unless the caller explicitly provides one.
   */
  private buildCacheKey(slug: string, options?: RenderOptions): string | null {
    if (options?.cacheKey) return options.cacheKey;

    const req = options?.request;
    if (req) {
      const hasAuth = req.headers.has("authorization") ||
        req.headers.has("cookie") ||
        req.headers.has("x-api-key");
      if (hasAuth) return null;
    }

    const url = options?.url;
    if (!url) return slug;

    const params = new URLSearchParams(url.searchParams);
    const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const queryString = sorted.map(([k, v]) => `${k}=${v}`).join("&");
    return queryString ? `${slug}?${queryString}` : slug;
  }

  private async doRenderPage(
    slug: string,
    ctx: RenderContext,
    options: RenderOptions | undefined,
    startTime: number,
    cacheKey: string | null,
  ): Promise<RenderResult> {
    const effectiveKey = cacheKey ?? crypto.randomUUID();
    const flightKey = this.getSingleflightKey(effectiveKey, ctx, options?.colorScheme);
    const isFollower = cacheKey ? this.renderFlight.has(flightKey) : false;

    const runRender = async () => {
      const services = this.createServicesForContext(ctx, options?.colorScheme);

      let result: RenderResult;
      try {
        result = await withTimeoutThrow(
          services.pipeline.renderPage(slug, {
            ...options,
            delivery: "string",
            projectId: ctx.projectId,
            projectSlug: ctx.projectSlug,
            environment: ctx.environment,
            contentSourceId: ctx.contentSourceId,
            skipCacheCheck: true,
            skipCachePersist: true,
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

      if (cacheKey) {
        await this.cache.persistResult(result, slug, ctx, options?.colorScheme, cacheKey);
      }

      logger.debug("[Renderer] Render complete (leader)", {
        slug,
        projectId: ctx.projectId,
        duration: `${(performance.now() - startTime).toFixed(2)}ms`,
        htmlLength: result.html?.length ?? 0,
      });

      return {
        html: result.html,
        frontmatter: result.frontmatter,
        headings: result.headings,
        ssrHash: result.ssrHash,
        pageModule: result.pageModule,
      };
    };

    const cachedData = cacheKey
      ? await this.renderFlight.do(flightKey, runRender)
      : await runRender();

    if (isFollower) {
      logger.debug("[Renderer] Render deduplicated (follower)", {
        slug,
        projectId: ctx.projectId,
        duration: `${(performance.now() - startTime).toFixed(2)}ms`,
        htmlLength: cachedData.html?.length ?? 0,
      });
    }

    return {
      html: cachedData.html,
      frontmatter: cachedData.frontmatter,
      headings: cachedData.headings,
      ssrHash: cachedData.ssrHash,
      pageModule: cachedData.pageModule,
      stream: null,
    };
  }

  resolvePageData(
    slug: string,
    ctx: RenderContext,
    options?: RenderOptions,
  ): Promise<PageDataResponse> {
    if (!this.initialized) {
      throw new Error("Renderer not initialized. Call initialize() first.");
    }

    const services = this.createServicesForContext(ctx);

    return services.pipeline.resolvePageData(slug, {
      ...options,
      projectId: ctx.projectId,
      projectSlug: ctx.projectSlug,
      environment: ctx.environment,
      contentSourceId: ctx.contentSourceId,
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
  ): { pipeline: RenderPipeline } {
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
      checkCache: async (slug: string, cacheKey?: string) => {
        const result = await this.cache.checkCache(slug, ctx, colorScheme, cacheKey);
        return {
          cachedResult: result.cachedResult,
          depAwareSlug: slug,
          moduleCacheKey: cacheKey ?? slug,
          cachedModule: result.cachedResult?.pageModule,
        };
      },
      persistResult: async (result: RenderResult, slug: string, cacheKey?: string) => {
        await this.cache.persistResult(result, slug, ctx, colorScheme, cacheKey);
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
  if (renderer) return renderer;

  renderer = new Renderer(options);
  await renderer.initialize(options?.shared);
  return renderer;
}

export function isRendererInitialized(): boolean {
  return renderer !== null && areSharedServicesInitialized();
}

export async function destroyRenderer(): Promise<void> {
  if (!renderer) return;

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
