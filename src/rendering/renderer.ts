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

import { rendererLogger } from "#veryfront/utils";
import { MDXCacheAdapter } from "#veryfront/transforms/mdx/index.ts";
import { INITIALIZATION_ERROR, SERVICE_OVERLOADED } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  buildQueryAwareCacheKey,
  buildRenderCachePrefix,
  type QueryParamCacheOptions,
} from "#veryfront/cache/keys.ts";
import { requestHasCacheSensitiveState } from "#veryfront/cache/request-cacheability.ts";
import { getEnvNumber } from "#veryfront/compat/process.ts";
import { getReadyManifestForRenderAsync } from "#veryfront/release-assets/manifest-cache.ts";
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
import type { HandlerContext } from "#veryfront/types";
import { TimeoutError, withTimeoutThrow } from "./utils/stream-utils.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import {
  acquireProjectSlot,
  projectRenderCounts,
  releaseProjectSlot,
  RENDER_ACQUIRE_TIMEOUT_MS,
  RENDER_PER_PROJECT_LIMIT,
  renderSemaphore,
} from "./renderer-concurrency.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";

const logger = rendererLogger.component("renderer");

/**
 * Master timeout for entire render pipeline (must be less than REQUEST_TIMEOUT_MS).
 * Configurable via RENDER_TIMEOUT_MS env var for cold-start scenarios.
 * Default increased to 60s to handle cold-start module transforms.
 */
const DEFAULT_RENDER_PIPELINE_TIMEOUT_MS = 60_000;
const RENDER_PIPELINE_TIMEOUT_MS = getEnvNumber("RENDER_TIMEOUT_MS") ??
  DEFAULT_RENDER_PIPELINE_TIMEOUT_MS;

/** Default number of sibling production routes to warm after the first cacheable request. */
const DEFAULT_RENDER_PREWARM_MAX_ROUTES = 12;
/** Default low-impact background concurrency for production route prewarm. */
const DEFAULT_RENDER_PREWARM_CONCURRENCY = 1;
/** Bound remembered release contexts so multi-tenant processes cannot grow without limit. */
const RENDER_PREWARM_CONTEXT_MAX_ENTRIES = 500;

const RENDER_PREWARM_MAX_ROUTES = getBoundedEnvNumber(
  "VERYFRONT_RENDER_PREWARM_MAX_ROUTES",
  DEFAULT_RENDER_PREWARM_MAX_ROUTES,
  0,
  100,
);
const RENDER_PREWARM_CONCURRENCY = getBoundedEnvNumber(
  "VERYFRONT_RENDER_PREWARM_CONCURRENCY",
  DEFAULT_RENDER_PREWARM_CONCURRENCY,
  1,
  8,
);

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

function getBoundedEnvNumber(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = getEnvNumber(name);
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeComparableSlug(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed || trimmed === "index" || trimmed === "/index") return "/";
  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  const normalized = withoutTrailingSlash.startsWith("/")
    ? withoutTrailingSlash
    : `/${withoutTrailingSlash}`;
  return normalized || "/";
}

function isConcretePrewarmSlug(slug: string): boolean {
  const comparable = normalizeComparableSlug(slug);
  return !comparable.includes("[") && !comparable.includes("]") && !comparable.includes("*");
}

function prewarmSlugDepth(slug: string): number {
  const comparable = normalizeComparableSlug(slug);
  if (comparable === "/") return 0;
  return comparable.split("/").filter(Boolean).length;
}

function prewarmSlugSegments(slug: string): string[] {
  const comparable = normalizeComparableSlug(slug);
  if (comparable === "/") return [];
  return comparable.split("/").filter(Boolean);
}

function prewarmRouteFamilyRank(currentSlug: string, candidateSlug: string): number {
  const currentSegments = prewarmSlugSegments(currentSlug);
  if (currentSegments.length === 0) return 0;

  const candidateSegments = prewarmSlugSegments(candidateSlug);
  if (candidateSegments[0] !== currentSegments[0]) return 2;
  if (currentSegments.length < 2) return 0;

  return candidateSegments[1] === currentSegments[1] ? 0 : 1;
}

function selectPrewarmSlugs(
  currentSlug: string,
  pages: string[],
): string[] {
  const currentComparable = normalizeComparableSlug(currentSlug);
  const seen = new Set<string>();
  const candidates: Array<{ comparable: string }> = [];

  for (const page of pages) {
    if (!isConcretePrewarmSlug(page)) continue;

    const comparable = normalizeComparableSlug(page);
    if (comparable === currentComparable || seen.has(comparable)) continue;

    seen.add(comparable);
    candidates.push({ comparable });
  }

  candidates.sort((a, b) =>
    prewarmRouteFamilyRank(currentComparable, a.comparable) -
      prewarmRouteFamilyRank(currentComparable, b.comparable) ||
    prewarmSlugDepth(a.comparable) - prewarmSlugDepth(b.comparable) ||
    a.comparable.localeCompare(b.comparable)
  );

  return candidates.map(({ comparable }) => comparable);
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
 * The Singleflight key includes cache prefix, slug, and colorScheme. The prefix
 * includes release and manifest version when a ready release asset manifest is
 * consumed, so JIT and manifest-backed renders never share in-flight work.
 */
export class Renderer {
  private cache: ContextAwareCacheCoordinator;
  private layoutComponentCache = createLayoutComponentCache();
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Singleflight for render deduplication. Caches HTML string results so
   * concurrent requests for the same page share the render work.
   * Key format: {cachePrefix}:{slug}:{colorScheme}
   */
  private renderFlight = new Singleflight<CachedRenderData>();
  private productionPrewarmContexts = new Map<string, Promise<void>>();

  constructor(options: RendererOptions = {}) {
    this.cache = new ContextAwareCacheCoordinator(options.cache);
  }

  async initialize(options?: SharedServicesOptions): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      const startTime = performance.now();
      logger.debug("Initializing...");

      await initializeSharedServices(options);

      this.initialized = true;
      logger.debug("Initialized", {
        duration: `${(performance.now() - startTime).toFixed(2)}ms`,
      });
    })();

    await this.initializationPromise;
    this.initializationPromise = null;
  }

  renderPage(slug: string, ctx: RenderContext, options?: RenderOptions): Promise<RenderResult> {
    return withSpan(
      "renderer.renderPage",
      async () => {
        if (!this.initialized) {
          throw INITIALIZATION_ERROR.create({
            detail: "Renderer not initialized. Call initialize() first.",
          });
        }

        const startTime = performance.now();
        logger.debug("Rendering page", {
          slug,
          projectId: ctx.projectId,
          environment: ctx.environment,
        });

        const releaseManifest = await this.resolveReleaseAssetManifest(ctx, options);
        const effectiveCtx = this.withManifestCachePrefix(ctx, releaseManifest);
        const effectiveOptions = {
          ...options,
          releaseAssetManifest: releaseManifest,
        };
        const cacheKey = this.buildCacheKey(slug, effectiveCtx, effectiveOptions);
        const cacheResult = cacheKey !== null
          ? await this.cache.checkCache(slug, effectiveCtx, effectiveOptions?.colorScheme, cacheKey)
          : { hit: false, cacheKey: "", status: "miss" as const, lookupDurationMs: 0 };
        if (cacheResult.hit && cacheResult.cachedResult) {
          logger.debug("Cache hit", {
            slug,
            projectId: effectiveCtx.projectId,
            colorScheme: effectiveOptions?.colorScheme,
            status: cacheResult.status,
            duration: `${(performance.now() - startTime).toFixed(2)}ms`,
          });
          if (cacheResult.status === "stale") {
            this.scheduleProductionRenderRefresh(slug, effectiveCtx, effectiveOptions, cacheKey);
          } else {
            this.scheduleProductionRenderPrewarm(slug, effectiveCtx, effectiveOptions, cacheKey);
          }
          return cacheResult.cachedResult;
        }

        const result = await this.doRenderPage(
          slug,
          effectiveCtx,
          effectiveOptions,
          startTime,
          cacheKey,
        );
        this.scheduleProductionRenderPrewarm(slug, effectiveCtx, effectiveOptions, cacheKey);
        return result;
      },
      {
        "renderer.slug": slug,
        "renderer.projectId": ctx.projectId,
        "renderer.environment": ctx.environment,
      },
    );
  }

  private async resolveReleaseAssetManifest(
    ctx: RenderContext,
    options?: RenderOptions,
  ): Promise<ReleaseAssetManifest | null> {
    if (options?.releaseAssetManifest !== undefined) {
      return options.releaseAssetManifest;
    }
    if (options?.studioEmbed || ctx.environment !== "production") return null;
    return await getReadyManifestForRenderAsync(ctx.releaseId);
  }

  private withManifestCachePrefix(
    ctx: RenderContext,
    releaseManifest: ReleaseAssetManifest | null,
  ): RenderContext {
    if (!releaseManifest || ctx.environment !== "production") return ctx;
    const releaseKey = ctx.releaseId ?? ctx.contentSourceId.replace(/^release-/, "");
    return {
      ...ctx,
      cachePrefix: buildRenderCachePrefix(
        ctx.projectId,
        ctx.environment,
        releaseKey,
        releaseManifest.manifestVersion,
      ),
    };
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
    return `${ctx.cachePrefix}:${slug}:${colorScheme ?? "default"}`;
  }

  /**
   * Compute a cache key that is query-aware and avoids caching personalized responses
   * (Authorization / Cookie / x-api-key) unless the caller explicitly provides one.
   *
   * Query param handling is configurable via `config.cache.queryParams`:
   * - "ignore-all": Ignore all query params (pages share cache regardless of URL params)
   * - "include-all": Include all query params (each unique query = separate cache)
   * - "include-list": Only include specified params
   * - "exclude-list": Exclude common tracking/cache-busting params (default)
   */
  private buildCacheKey(
    slug: string,
    ctx: RenderContext,
    options?: RenderOptions,
  ): string | null {
    if (options?.cacheKey) return options.cacheKey;

    const req = options?.request;
    if (req) {
      if (requestHasCacheSensitiveState(req)) return null;
    }

    // Get query param handling options from config
    const queryParamOptions = ctx.config?.cache?.queryParams as QueryParamCacheOptions | undefined;

    return buildQueryAwareCacheKey(slug, options?.url, queryParamOptions);
  }

  private scheduleProductionRenderPrewarm(
    currentSlug: string,
    ctx: RenderContext,
    options: RenderOptions | undefined,
    cacheKey: string | null,
  ): void {
    if (!this.shouldScheduleProductionPrewarm(ctx, options, cacheKey)) return;

    const prewarmKey = this.getProductionPrewarmKey(ctx);
    if (this.productionPrewarmContexts.has(prewarmKey)) return;

    const prewarmOptions = this.buildCanonicalPrewarmOptions(ctx, options);
    let resolvePromise!: () => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    this.rememberProductionPrewarm(prewarmKey, promise);

    queueMicrotask(() => {
      void this.runProductionRenderPrewarm(currentSlug, ctx, prewarmOptions)
        .then(resolvePromise, rejectPromise);
    });

    promise.catch((error) => {
      this.productionPrewarmContexts.delete(prewarmKey);
      logger.warn("Production render prewarm failed", {
        projectId: ctx.projectId,
        releaseId: ctx.releaseId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private shouldScheduleProductionPrewarm(
    ctx: RenderContext,
    options: RenderOptions | undefined,
    cacheKey: string | null,
  ): boolean {
    if (RENDER_PREWARM_MAX_ROUTES <= 0) return false;
    return this.shouldScheduleProductionStaleRefresh(ctx, options, cacheKey);
  }

  private shouldScheduleProductionStaleRefresh(
    ctx: RenderContext,
    options: RenderOptions | undefined,
    cacheKey: string | null,
  ): boolean {
    if (cacheKey === null) return false;
    if (ctx.environment !== "production" || ctx.mode !== "production") return false;
    if (!ctx.adapter?.fs) return false;
    if (options?.studioEmbed) return false;
    if (options?.params || options?.props) return false;
    return true;
  }

  private getProductionPrewarmKey(ctx: RenderContext): string {
    return `${ctx.cachePrefix}:canonical`;
  }

  private rememberProductionPrewarm(key: string, promise: Promise<void>): void {
    while (this.productionPrewarmContexts.size >= RENDER_PREWARM_CONTEXT_MAX_ENTRIES) {
      const oldest = this.productionPrewarmContexts.keys().next().value;
      if (oldest === undefined) break;
      this.productionPrewarmContexts.delete(oldest);
    }
    this.productionPrewarmContexts.set(key, promise);
  }

  private buildCanonicalPrewarmOptions(
    ctx: RenderContext,
    options?: RenderOptions,
  ): RenderOptions {
    return {
      environment: ctx.environment,
      projectId: ctx.projectId,
      projectSlug: ctx.projectSlug,
      contentSourceId: ctx.contentSourceId,
      releaseId: ctx.releaseId,
      releaseAssetManifest: options?.releaseAssetManifest ?? null,
      noHmr: options?.noHmr,
      forceProductionScripts: options?.forceProductionScripts,
    };
  }

  private buildStaleRefreshOptions(
    ctx: RenderContext,
    options?: RenderOptions,
  ): RenderOptions {
    return {
      ...this.buildCanonicalPrewarmOptions(ctx, options),
      request: options?.request,
      url: options?.url,
      cacheKey: options?.cacheKey,
      colorScheme: options?.colorScheme,
      colorSchemeFromParam: options?.colorSchemeFromParam,
      colorSchemeFromHeader: options?.colorSchemeFromHeader,
    };
  }

  private scheduleProductionRenderRefresh(
    slug: string,
    ctx: RenderContext,
    options: RenderOptions | undefined,
    cacheKey: string | null,
  ): void {
    if (!this.shouldScheduleProductionStaleRefresh(ctx, options, cacheKey)) return;

    const refreshKey = `${ctx.cachePrefix}:refresh:${cacheKey}`;
    if (this.productionPrewarmContexts.has(refreshKey)) return;

    const refreshOptions = this.buildStaleRefreshOptions(ctx, options);
    let resolvePromise!: () => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    this.rememberProductionPrewarm(refreshKey, promise);

    setTimeout(() => {
      void this.doRenderPage(slug, ctx, refreshOptions, performance.now(), cacheKey)
        .then(() => {
          this.scheduleProductionRenderPrewarm(slug, ctx, refreshOptions, cacheKey);
          resolvePromise();
        }, rejectPromise);
    }, 0);

    promise.finally(() => {
      this.productionPrewarmContexts.delete(refreshKey);
    }).catch((error) => {
      logger.warn("Production stale render refresh failed", {
        slug,
        projectId: ctx.projectId,
        releaseId: ctx.releaseId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async runProductionRenderPrewarm(
    currentSlug: string,
    ctx: RenderContext,
    options: RenderOptions,
  ): Promise<void> {
    if (RENDER_PREWARM_MAX_ROUTES <= 0) return;

    const pages = await this.getAllPages(ctx);
    const candidateSlugs = selectPrewarmSlugs(currentSlug, pages);
    const slugs = await this.filterResolvablePrewarmSlugs(
      ctx,
      candidateSlugs,
      RENDER_PREWARM_MAX_ROUTES,
    );
    if (slugs.length === 0) return;

    logger.debug("Production render prewarm started", {
      projectId: ctx.projectId,
      releaseId: ctx.releaseId,
      currentSlug,
      routeCount: slugs.length,
      concurrency: RENDER_PREWARM_CONCURRENCY,
    });

    let nextIndex = 0;
    const workerCount = Math.min(RENDER_PREWARM_CONCURRENCY, slugs.length);

    const runWorker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= slugs.length) return;

        const slug = slugs[index]!;
        try {
          await this.renderPage(slug, ctx, options);
        } catch (error) {
          logger.warn("Production render prewarm route failed", {
            slug,
            projectId: ctx.projectId,
            releaseId: ctx.releaseId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    logger.debug("Production render prewarm finished", {
      projectId: ctx.projectId,
      releaseId: ctx.releaseId,
      routeCount: slugs.length,
    });
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
    const isFollower = cacheKey !== null ? this.renderFlight.has(flightKey) : false;

    const runRender = async () => {
      try {
        return await this.runRenderWithCapacity(slug, ctx, options, startTime, cacheKey);
      } catch (error) {
        if (error instanceof TimeoutError) {
          logger.error("Render pipeline timeout - aborting", {
            slug,
            projectId: ctx.projectId,
            timeoutMs: RENDER_PIPELINE_TIMEOUT_MS,
          });
        }
        throw error;
      }
    };

    const cachedData = cacheKey !== null
      ? await this.renderFlight.do(flightKey, runRender)
      : await runRender();

    if (isFollower) {
      logger.debug("Render deduplicated (follower)", {
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

  private async runRenderWithCapacity(
    slug: string,
    ctx: RenderContext,
    options: RenderOptions | undefined,
    startTime: number,
    cacheKey: string | null,
  ): Promise<CachedRenderData> {
    if (!(await acquireProjectSlot(ctx.projectId))) {
      const activeCount = projectRenderCounts.get(ctx.projectId) ?? 0;
      logger.error("Per-project render limit reached", {
        slug,
        projectId: ctx.projectId,
        activeRenders: activeCount,
        limit: RENDER_PER_PROJECT_LIMIT,
      });
      throw SERVICE_OVERLOADED.create({
        detail:
          `Per-project render limit reached (${activeCount}/${RENDER_PER_PROJECT_LIMIT} active). Try again shortly.`,
        context: {
          slug,
          projectId: ctx.projectId,
          activeRenders: activeCount,
          limit: RENDER_PER_PROJECT_LIMIT,
        },
      });
    }

    const acquired = await renderSemaphore.tryAcquire(RENDER_ACQUIRE_TIMEOUT_MS);
    if (!acquired) {
      await releaseProjectSlot(ctx.projectId);
      logger.error("Render capacity exceeded - service overloaded", {
        slug,
        projectId: ctx.projectId,
        waiting: renderSemaphore.waiting,
        available: renderSemaphore.available,
      });
      throw SERVICE_OVERLOADED.create({
        detail:
          `Render capacity exceeded (${renderSemaphore.waiting} waiting). Service is overloaded.`,
        context: { slug, projectId: ctx.projectId, waiting: renderSemaphore.waiting },
      });
    }

    try {
      const services = this.createServicesForContext(ctx, options?.colorScheme);
      const result = await withTimeoutThrow(
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

      if (cacheKey !== null) {
        await this.cache.persistResult(result, slug, ctx, options?.colorScheme, cacheKey);
      }

      logger.debug("Render complete (leader)", {
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
    } finally {
      renderSemaphore.release();
      await releaseProjectSlot(ctx.projectId);
    }
  }

  resolvePageData(
    slug: string,
    ctx: RenderContext,
    options?: RenderOptions,
  ): Promise<PageDataResponse> {
    if (!this.initialized) {
      throw INITIALIZATION_ERROR.create({
        detail: "Renderer not initialized. Call initialize() first.",
      });
    }

    return withSpan("renderer.resolvePageData", async () => {
      const releaseManifest = await this.resolveReleaseAssetManifest(ctx, options);
      const effectiveCtx = this.withManifestCachePrefix(ctx, releaseManifest);
      const services = this.createServicesForContext(effectiveCtx);

      return services.pipeline.resolvePageData(slug, {
        ...options,
        projectId: effectiveCtx.projectId,
        projectSlug: effectiveCtx.projectSlug,
        environment: effectiveCtx.environment,
        contentSourceId: effectiveCtx.contentSourceId,
        releaseId: effectiveCtx.releaseId,
        releaseAssetManifest: releaseManifest,
      });
    }, {
      "renderer.slug": slug,
      "renderer.projectId": ctx.projectId,
      "renderer.environment": ctx.environment,
    });
  }

  getAllPages(ctx: RenderContext): Promise<string[]> {
    if (!this.initialized) {
      throw INITIALIZATION_ERROR.create({
        detail: "Renderer not initialized. Call initialize() first.",
      });
    }

    return createPageResolver(ctx).getAllPages();
  }

  async pageExists(slug: string, ctx: RenderContext): Promise<boolean> {
    if (!this.initialized) {
      throw INITIALIZATION_ERROR.create({
        detail: "Renderer not initialized. Call initialize() first.",
      });
    }

    return createPageResolver(ctx).pageExists(slug);
  }

  private async filterResolvablePrewarmSlugs(
    ctx: RenderContext,
    slugs: string[],
    maxRoutes: number,
  ): Promise<string[]> {
    if (maxRoutes <= 0) return [];

    const resolvable: string[] = [];

    for (const slug of slugs) {
      try {
        if (await this.pageExists(slug, ctx)) {
          resolvable.push(slug);
          if (resolvable.length >= maxRoutes) break;
        }
      } catch (error) {
        logger.warn("Production render prewarm route validation failed", {
          slug,
          projectId: ctx.projectId,
          releaseId: ctx.releaseId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return resolvable;
  }

  async clearCache(ctx: RenderContext, slug?: string): Promise<void> {
    if (slug) {
      await this.cache.clearSlug(slug, ctx);
      return;
    }
    await this.cache.clearForContext(ctx);
  }

  async clearCacheForProject(projectId: string): Promise<void> {
    logger.debug("Clearing render cache for project", { projectId });
    await this.cache.clearForProject(projectId);
  }

  async destroy(): Promise<void> {
    await this.cache.destroy();
    this.productionPrewarmContexts.clear();
    this.initialized = false;
    this.initializationPromise = null;
    logger.debug("Destroyed");
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
      layoutCache: this.layoutComponentCache,
      componentRegistry: componentRegistry.getAllAsComponents(),
    });

    const htmlGenerator = new HTMLGenerator({
      projectDir: ctx.projectDir,
      adapter: ctx.adapter,
      config: ctx.config,
      mode: ctx.mode,
      isLocalProject: ctx.isLocalProject === true,
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
          cacheStatus: result.status,
          lookupDurationMs: result.lookupDurationMs,
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
      cacheCoordinator: pipelineCacheCoordinator,
      pageRenderer,
      layoutOrchestrator,
      ssrOrchestrator,
      adapter: ctx.adapter,
      mode: ctx.mode,
      projectDir: ctx.projectDir,
      isLocalProject: ctx.isLocalProject === true,
      projectId: ctx.projectId,
      contentSourceId: ctx.contentSourceId,
      config: ctx.config,
      directories: ctx.config.directories,
      queryParamOptions: ctx.config?.cache?.queryParams as QueryParamCacheOptions | undefined,
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
let rendererInitializationPromise: Promise<Renderer> | null = null;
let rendererGeneration = 0;

export function getRenderer(): Renderer {
  if (!renderer) {
    throw INITIALIZATION_ERROR.create({
      detail: "Renderer not initialized. Call initializeRenderer() first.",
    });
  }
  return renderer;
}

export async function initializeRenderer(options?: RendererOptions): Promise<Renderer> {
  if (renderer) return renderer;
  if (rendererInitializationPromise) return rendererInitializationPromise;

  const nextRenderer = new Renderer(options);
  const generation = rendererGeneration;
  rendererInitializationPromise = (async () => {
    try {
      await nextRenderer.initialize(options?.shared);
      if (generation !== rendererGeneration) {
        await nextRenderer.destroy();
        throw INITIALIZATION_ERROR.create({
          detail: "Renderer initialization was cancelled before it completed.",
        });
      }
      renderer = nextRenderer;
      return nextRenderer;
    } finally {
      rendererInitializationPromise = null;
    }
  })();
  return rendererInitializationPromise;
}

export function isRendererInitialized(): boolean {
  return renderer !== null && areSharedServicesInitialized();
}

export async function destroyRenderer(): Promise<void> {
  rendererGeneration++;
  rendererInitializationPromise = null;
  const currentRenderer = renderer;
  renderer = null;
  if (!currentRenderer) return;

  await currentRenderer.destroy();
}

export async function clearRendererCacheForProject(projectId: string): Promise<void> {
  logger.debug("clearRendererCacheForProject called", {
    projectId,
    hasRenderer: !!renderer,
  });

  if (!renderer) {
    logger.debug("No renderer instance, skipping project cache clear", { projectId });
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
