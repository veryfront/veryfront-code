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

import { isCompiledBinary, rendererLogger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path";
import { MDXCacheAdapter } from "#veryfront/transforms/mdx/index.ts";
import { INITIALIZATION_ERROR, SERVICE_OVERLOADED } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  buildQueryAwareCacheKey,
  buildRenderCachePrefix,
  type QueryParamCacheOptions,
} from "#veryfront/cache/keys.ts";
import { requestHasCacheSensitiveState } from "#veryfront/cache/request-cacheability.ts";
import { getEnvBoolean, getEnvNumber, getEnvString } from "#veryfront/compat/process.ts";
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
import { Singleflight, waitForSharedPromise } from "#veryfront/utils/singleflight.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import {
  acquireProjectSlot,
  projectRenderCounts,
  releaseProjectSlot,
  RENDER_ACQUIRE_TIMEOUT_MS,
  RENDER_PER_PROJECT_LIMIT,
  renderSemaphore,
} from "./renderer-concurrency.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import type { ComponentRegistry } from "./ssr/component-registry.ts";
import type { VirtualModuleSystem } from "./virtual-module-system.ts";
import { addNonceToHtmlTags } from "#veryfront/html/nonce-injection.ts";

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
/** Bound project-scoped virtual-module/component registries in shared runtimes. */
const RENDER_CONTEXT_SERVICE_MAX_ENTRIES = 500;

interface RendererContextServices {
  readonly projectId: string;
  readonly contentSourceId: string;
  readonly virtualModules: VirtualModuleSystem;
  readonly componentRegistry: ComponentRegistry;
  componentInitialization: Promise<void> | null;
  componentsInitialized: boolean;
}

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
  css?: string;
  frontmatter: RenderResult["frontmatter"];
  headings?: RenderResult["headings"];
  nodeMap?: RenderResult["nodeMap"];
  ssrHash?: string;
  pageModule?: RenderResult["pageModule"];
}

interface RenderCachePolicy {
  /** Canonical storage identity, including configuration generation. */
  cacheKey: string | null;
  check: boolean;
  persist: boolean;
  singleflight: boolean;
  configDigest: string | null;
}

interface ProjectRenderGeneration {
  generation: number;
  activeRenders: number;
  invalidation?: Promise<void>;
}

interface ProjectRenderToken {
  readonly projectId: string;
  readonly state: ProjectRenderGeneration;
  readonly generation: number;
}

const BYPASS_RENDER_CACHE: RenderCachePolicy = {
  cacheKey: null,
  check: false,
  persist: false,
  singleflight: false,
  configDigest: null,
};

function cloneCachedRenderData(data: CachedRenderData): RenderResult {
  const cloned = structuredClone(data);
  return {
    html: cloned.html,
    css: cloned.css,
    frontmatter: cloned.frontmatter,
    headings: cloned.headings,
    nodeMap: cloned.nodeMap,
    ssrHash: cloned.ssrHash,
    pageModule: cloned.pageModule,
    stream: null,
  };
}

function snapshotRenderResult(result: RenderResult): CachedRenderData {
  return structuredClone({
    html: result.html,
    css: result.css,
    frontmatter: result.frontmatter,
    headings: result.headings,
    nodeMap: result.nodeMap,
    ssrHash: result.ssrHash,
    pageModule: result.pageModule,
  });
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
  private lifecycleGeneration = 0;
  private destroyed = false;

  /**
   * Singleflight for render deduplication. Caches HTML string results so
   * concurrent requests for the same page share the render work.
   * Key format: {cachePrefix}:{slug}:{colorScheme}
   */
  private renderFlight = new Singleflight<CachedRenderData>();
  private productionPrewarmContexts = new Map<string, Promise<void>>();
  private contextServices = new Map<string, RendererContextServices>();
  /**
   * Generations exist only while a project has active render/cache-lookup work.
   * This prevents unbounded tenant retention while letting invalidation split
   * old and new singleflight groups and block stale post-clear persistence.
   */
  private projectRenderGenerations = new Map<string, ProjectRenderGeneration>();

  constructor(options: RendererOptions = {}) {
    this.cache = new ContextAwareCacheCoordinator(options.cache);
  }

  private async beginProjectRender(projectId: string): Promise<ProjectRenderToken> {
    let state = this.projectRenderGenerations.get(projectId);
    if (!state) {
      state = { generation: 0, activeRenders: 0 };
      this.projectRenderGenerations.set(projectId, state);
    }
    state.activeRenders++;
    try {
      if (state.invalidation) await state.invalidation;
      return { projectId, state, generation: state.generation };
    } catch (error) {
      state.activeRenders--;
      if (state.activeRenders === 0 && this.projectRenderGenerations.get(projectId) === state) {
        this.projectRenderGenerations.delete(projectId);
      }
      throw error;
    }
  }

  private endProjectRender(token: ProjectRenderToken): void {
    token.state.activeRenders = Math.max(0, token.state.activeRenders - 1);
    if (
      token.state.activeRenders === 0 && !token.state.invalidation &&
      this.projectRenderGenerations.get(token.projectId) === token.state
    ) {
      this.projectRenderGenerations.delete(token.projectId);
    }
  }

  private async runProjectCacheInvalidation(
    projectId: string,
    invalidate: () => Promise<void>,
  ): Promise<void> {
    let state = this.projectRenderGenerations.get(projectId);
    if (!state) {
      state = { generation: 0, activeRenders: 0 };
      this.projectRenderGenerations.set(projectId, state);
    }
    state.generation++;

    const previous = state.invalidation;
    const operation = (async () => {
      if (previous) await previous.catch(() => undefined);
      await invalidate();
    })();
    state.invalidation = operation;

    try {
      await operation;
    } finally {
      if (state.invalidation === operation) state.invalidation = undefined;
      if (
        state.activeRenders === 0 && !state.invalidation &&
        this.projectRenderGenerations.get(projectId) === state
      ) {
        this.projectRenderGenerations.delete(projectId);
      }
    }
  }

  private invalidateAllProjectRenders(): void {
    for (const state of this.projectRenderGenerations.values()) state.generation++;
  }

  private isProjectRenderCurrent(token: ProjectRenderToken): boolean {
    return token.state.generation === token.generation;
  }

  private applyRequestSpecificOutput(
    result: RenderResult,
    options?: RenderOptions,
  ): RenderResult {
    if (!options?.nonce || !result.html) return result;
    return {
      ...result,
      html: addNonceToHtmlTags(result.html, options.nonce),
    };
  }

  async initialize(options?: SharedServicesOptions): Promise<void> {
    if (this.initialized) return;
    if (this.destroyed) {
      throw INITIALIZATION_ERROR.create({
        detail: "A destroyed renderer cannot be initialized again.",
      });
    }
    if (this.initializationPromise) return this.initializationPromise;

    const generation = this.lifecycleGeneration;
    const initialization = (async () => {
      const startTime = performance.now();
      logger.debug("Initializing...");

      await initializeSharedServices(options);

      if (this.destroyed || generation !== this.lifecycleGeneration) {
        throw INITIALIZATION_ERROR.create({
          detail: "Renderer initialization was cancelled before it completed.",
        });
      }

      this.initialized = true;
      logger.debug("Initialized", {
        duration: `${(performance.now() - startTime).toFixed(2)}ms`,
      });
    })();
    this.initializationPromise = initialization;

    try {
      await initialization;
    } finally {
      if (this.initializationPromise === initialization) {
        this.initializationPromise = null;
      }
    }
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

        const renderToken = await this.beginProjectRender(ctx.projectId);
        try {
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
          const cachePolicy = await this.buildCachePolicy(slug, effectiveCtx, effectiveOptions);
          const cacheResult = cachePolicy.check && cachePolicy.cacheKey !== null
            ? await this.cache.checkCache(
              slug,
              effectiveCtx,
              effectiveOptions?.colorScheme,
              cachePolicy.cacheKey,
            )
            : { hit: false, cacheKey: "", status: "miss" as const, lookupDurationMs: 0 };
          if (cacheResult.hit && cacheResult.cachedResult) {
            logger.debug("Cache hit", {
              slug,
              projectId: effectiveCtx.projectId,
              colorScheme: effectiveOptions?.colorScheme,
              status: cacheResult.status,
              duration: `${(performance.now() - startTime).toFixed(2)}ms`,
            });
            if (cacheResult.status === "stale" && this.isProjectRenderCurrent(renderToken)) {
              this.scheduleProductionRenderRefresh(
                slug,
                effectiveCtx,
                effectiveOptions,
                cachePolicy,
              );
            } else if (this.isProjectRenderCurrent(renderToken)) {
              this.scheduleProductionRenderPrewarm(
                slug,
                effectiveCtx,
                effectiveOptions,
                cachePolicy,
              );
            }
            return this.applyRequestSpecificOutput(cacheResult.cachedResult, effectiveOptions);
          }

          const result = await this.doRenderPage(
            slug,
            effectiveCtx,
            effectiveOptions,
            startTime,
            cachePolicy,
            renderToken,
            effectiveOptions.abortSignal ?? effectiveOptions.request?.signal,
          );
          if (this.isProjectRenderCurrent(renderToken)) {
            this.scheduleProductionRenderPrewarm(
              slug,
              effectiveCtx,
              effectiveOptions,
              cachePolicy,
            );
          }
          return this.applyRequestSpecificOutput(result, effectiveOptions);
        } finally {
          this.endProjectRender(renderToken);
        }
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
    generation = 0,
  ): string {
    return `${ctx.cachePrefix}:${slug}:${colorScheme ?? "default"}:generation-${generation}`;
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
  private async buildCachePolicy(
    slug: string,
    ctx: RenderContext,
    options?: RenderOptions,
  ): Promise<RenderCachePolicy> {
    if (!this.isCanonicalCacheVariant(ctx, options)) return BYPASS_RENDER_CACHE;

    const req = options?.request;
    if (req && !options?.cacheKey) return BYPASS_RENDER_CACHE;
    if (req && requestHasCacheSensitiveState(req)) return BYPASS_RENDER_CACHE;

    // Get query param handling options from config
    const queryParamOptions = ctx.config?.cache?.queryParams as QueryParamCacheOptions | undefined;
    const baseKey = options?.cacheKey ||
      buildQueryAwareCacheKey(slug, options?.url, queryParamOptions);

    let serializedConfig: string | undefined;
    try {
      serializedConfig = JSON.stringify(ctx.config);
    } catch (error) {
      logger.warn("Render cache bypassed because configuration is not serializable", {
        projectId: ctx.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return BYPASS_RENDER_CACHE;
    }
    if (serializedConfig === undefined) return BYPASS_RENDER_CACHE;

    const configDigest = await computeHash(serializedConfig);
    const cacheKey = `${baseKey}:config-${configDigest}`;
    const check = options?.skipCacheCheck !== true;
    const persist = options?.skipCachePersist !== true;

    return {
      cacheKey,
      check,
      persist,
      singleflight: check,
      configDigest,
    };
  }

  private isCanonicalCacheVariant(
    ctx: RenderContext,
    options?: RenderOptions,
  ): boolean {
    if (options?.delivery === "stream") return false;
    if (ctx.nonce) return false;
    // An explicit public cache contract may cache a nonce-free artifact and
    // apply the response nonce after lookup. Without that contract, nonce is a
    // request-scoped variant and must bypass shared work.
    if (options?.nonce && !options.cacheKey) return false;
    if (options?.studioEmbed) return false;
    if (options?.props !== undefined || options?.params !== undefined) return false;
    if (options?.pageId !== undefined || options?.layoutProps !== undefined) return false;
    if (options?.renderSessionId !== undefined && !options.cacheKey) return false;
    if (options?.clientPageIsland !== undefined) {
      return false;
    }
    if (options?.noHmr || options?.forceProductionScripts) return false;
    if (options?.colorSchemeFromParam || options?.colorSchemeFromHeader) return false;
    return true;
  }

  private scheduleProductionRenderPrewarm(
    currentSlug: string,
    ctx: RenderContext,
    options: RenderOptions | undefined,
    cachePolicy: RenderCachePolicy,
  ): void {
    if (!this.shouldScheduleProductionPrewarm(ctx, options, cachePolicy)) return;

    const prewarmKey = this.getProductionPrewarmKey(ctx, cachePolicy);
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
    cachePolicy: RenderCachePolicy,
  ): boolean {
    if (RENDER_PREWARM_MAX_ROUTES <= 0) return false;
    return this.shouldScheduleProductionStaleRefresh(ctx, options, cachePolicy);
  }

  private shouldScheduleProductionStaleRefresh(
    ctx: RenderContext,
    options: RenderOptions | undefined,
    cachePolicy: RenderCachePolicy,
  ): boolean {
    if (!cachePolicy.persist || cachePolicy.cacheKey === null) return false;
    if (ctx.environment !== "production" || ctx.mode !== "production") return false;
    if (!ctx.adapter?.fs) return false;
    if (options?.studioEmbed) return false;
    if (options?.params || options?.props) return false;
    return true;
  }

  private getProductionPrewarmKey(
    ctx: RenderContext,
    cachePolicy: RenderCachePolicy,
  ): string {
    return `${ctx.cachePrefix}:canonical:${cachePolicy.configDigest}`;
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
    cachePolicy: RenderCachePolicy,
  ): void {
    if (!this.shouldScheduleProductionStaleRefresh(ctx, options, cachePolicy)) return;

    const refreshKey = `${ctx.cachePrefix}:refresh:${cachePolicy.cacheKey}`;
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
      void (async () => {
        const renderToken = await this.beginProjectRender(ctx.projectId);
        try {
          await this.doRenderPage(
            slug,
            ctx,
            refreshOptions,
            performance.now(),
            {
              ...cachePolicy,
              check: false,
              singleflight: false,
            },
            renderToken,
            undefined,
          );
          if (this.isProjectRenderCurrent(renderToken)) {
            this.scheduleProductionRenderPrewarm(slug, ctx, refreshOptions, cachePolicy);
          }
          resolvePromise();
        } catch (error) {
          rejectPromise(error);
        } finally {
          this.endProjectRender(renderToken);
        }
      })();
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
    cachePolicy: RenderCachePolicy,
    renderToken: ProjectRenderToken,
    callerSignal: AbortSignal | undefined,
  ): Promise<RenderResult> {
    const effectiveKey = cachePolicy.cacheKey ?? crypto.randomUUID();
    const flightKey = this.getSingleflightKey(
      effectiveKey,
      ctx,
      options?.colorScheme,
      renderToken.generation,
    );
    const isFollower = cachePolicy.singleflight ? this.renderFlight.has(flightKey) : false;

    const runRenderWithLogging = async (
      signal: AbortSignal | undefined,
    ): Promise<RenderResult> => {
      try {
        return await this.runRenderWithCapacity(
          slug,
          ctx,
          options,
          startTime,
          cachePolicy,
          renderToken,
          signal,
        );
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

    if (!cachePolicy.singleflight) {
      return await runRenderWithLogging(callerSignal);
    }

    const runSharedRender = async (): Promise<CachedRenderData> => {
      // A caller may detach while the shared leader continues. Retain the
      // generation until the underlying render settles so invalidation can
      // still prevent that leader from repopulating cleared cache state.
      renderToken.state.activeRenders++;
      try {
        return snapshotRenderResult(await runRenderWithLogging(undefined));
      } finally {
        this.endProjectRender(renderToken);
      }
    };
    const sharedRender = cachePolicy.cacheKey !== null
      ? this.renderFlight.do(flightKey, runSharedRender)
      : runSharedRender();
    const cachedData = await waitForSharedPromise(sharedRender, callerSignal);

    if (isFollower) {
      logger.debug("Render deduplicated (follower)", {
        slug,
        projectId: ctx.projectId,
        duration: `${(performance.now() - startTime).toFixed(2)}ms`,
        htmlLength: cachedData.html?.length ?? 0,
      });
    }

    return cloneCachedRenderData(cachedData);
  }

  private async runRenderWithCapacity(
    slug: string,
    ctx: RenderContext,
    options: RenderOptions | undefined,
    startTime: number,
    cachePolicy: RenderCachePolicy,
    renderToken: ProjectRenderToken,
    callerSignal: AbortSignal | undefined,
  ): Promise<RenderResult> {
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
      await this.initializeComponents(ctx);
      const services = this.createServicesForContext(ctx, options?.colorScheme);
      const renderAbortController = new AbortController();
      const pipelineOptions = cachePolicy.cacheKey !== null && options?.cacheKey
        ? { ...options, nonce: undefined }
        : options;
      const request = cachePolicy.cacheKey !== null && pipelineOptions?.request
        ? new Request(pipelineOptions.request, { signal: renderAbortController.signal })
        : pipelineOptions?.request;
      const result = await withTimeoutThrow(
        services.pipeline.renderPage(slug, {
          ...pipelineOptions,
          request,
          abortSignal: renderAbortController.signal,
          projectId: ctx.projectId,
          projectSlug: ctx.projectSlug,
          environment: ctx.environment,
          contentSourceId: ctx.contentSourceId,
          skipCacheCheck: true,
          skipCachePersist: true,
        }),
        RENDER_PIPELINE_TIMEOUT_MS,
        `Render pipeline for ${ctx.projectId}:${slug}`,
        {
          signal: cachePolicy.singleflight ? undefined : callerSignal,
          onAbort: (reason) => renderAbortController.abort(reason),
          onTimeout: (error) => renderAbortController.abort(error),
        },
      );

      if (
        cachePolicy.persist && cachePolicy.cacheKey !== null &&
        this.isProjectRenderCurrent(renderToken)
      ) {
        await this.cache.persistResult(
          result,
          slug,
          ctx,
          options?.colorScheme,
          cachePolicy.cacheKey,
        );
      }

      logger.debug("Render complete (leader)", {
        slug,
        projectId: ctx.projectId,
        duration: `${(performance.now() - startTime).toFixed(2)}ms`,
        htmlLength: result.html?.length ?? 0,
      });

      return result;
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
      await this.initializeComponents(effectiveCtx);
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
    await this.runProjectCacheInvalidation(ctx.projectId, async () => {
      if (slug) {
        await this.cache.clearSlug(slug, ctx);
        return;
      }
      await this.cache.clearForContext(ctx);
      this.releaseContextServices(ctx);
    });
  }

  async clearCacheForProject(projectId: string): Promise<void> {
    logger.debug("Clearing render cache for project", { projectId });
    await this.runProjectCacheInvalidation(projectId, async () => {
      await this.cache.clearForProject(projectId);
      for (const [key, services] of this.contextServices) {
        if (services.projectId !== projectId) continue;
        this.disposeContextServices(key, services);
      }
    });
  }

  getVirtualModuleSystem(ctx: RenderContext): VirtualModuleSystem {
    this.assertReady();
    return this.getContextServices(ctx).virtualModules;
  }

  initializeComponents(ctx: RenderContext): Promise<void> {
    this.assertReady();
    const services = this.getContextServices(ctx);
    if (services.componentsInitialized) return Promise.resolve();
    if (services.componentInitialization) return services.componentInitialization;

    const initialization = (async () => {
      const isVeryFrontAPI = ctx.config.fs?.type === "veryfront-api";
      if (!isCompiledBinary() && !isVeryFrontAPI) {
        for (const directory of ctx.config.directories?.components ?? ["components"]) {
          await services.componentRegistry.loadFromDirectory(
            join(ctx.projectDir, directory),
            false,
          );
        }
      }
      await services.componentRegistry.initializeComponents();
      if (this.destroyed) {
        throw INITIALIZATION_ERROR.create({
          detail: "Renderer was destroyed while components were initializing.",
        });
      }
      services.componentsInitialized = true;
    })();
    services.componentInitialization = initialization;
    return initialization.finally(() => {
      if (services.componentInitialization === initialization) {
        services.componentInitialization = null;
      }
    });
  }

  async releaseContext(ctx: RenderContext): Promise<void> {
    await this.runProjectCacheInvalidation(ctx.projectId, async () => {
      await this.cache.clearForContext(ctx);
      this.releaseContextServices(ctx);
    });
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.lifecycleGeneration++;
    this.invalidateAllProjectRenders();
    this.initialized = false;
    this.initializationPromise = null;
    for (const [key, services] of this.contextServices) {
      this.disposeContextServices(key, services);
    }
    await this.cache.destroy();
    this.productionPrewarmContexts.clear();
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
      scope: JSON.stringify([ctx.projectId, ctx.contentSourceId]),
    });

    const mdxCompiler = new MDXCompiler({
      projectDir: ctx.projectDir,
      mode: ctx.mode,
      mdxCacheAdapter,
    });

    const compileMDX = mdxCompiler.compileMDX.bind(mdxCompiler);

    const { componentRegistry } = this.getContextServices(ctx);
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

  private assertReady(): void {
    if (!this.initialized || this.destroyed) {
      throw INITIALIZATION_ERROR.create({
        detail: "Renderer not initialized. Call initialize() first.",
      });
    }
  }

  private contextServicesKey(ctx: RenderContext): string {
    return JSON.stringify([
      ctx.projectId,
      ctx.contentSourceId,
      ctx.projectDir,
      ctx.port ?? null,
      ctx.moduleServerUrl ?? null,
    ]);
  }

  private getContextServices(ctx: RenderContext): RendererContextServices {
    const key = this.contextServicesKey(ctx);
    const existing = this.contextServices.get(key);
    if (existing) {
      // Refresh insertion order so deterministic capacity eviction is LRU.
      this.contextServices.delete(key);
      this.contextServices.set(key, existing);
      return existing;
    }

    const virtualModules = createVirtualModuleSystem(ctx);
    const services: RendererContextServices = {
      projectId: ctx.projectId,
      contentSourceId: ctx.contentSourceId,
      virtualModules,
      componentRegistry: createComponentRegistry(ctx, virtualModules),
      componentInitialization: null,
      componentsInitialized: false,
    };
    this.contextServices.set(key, services);

    while (this.contextServices.size > RENDER_CONTEXT_SERVICE_MAX_ENTRIES) {
      const oldest = this.contextServices.entries().next().value as
        | [string, RendererContextServices]
        | undefined;
      if (!oldest) break;
      this.disposeContextServices(oldest[0], oldest[1]);
    }
    return services;
  }

  private releaseContextServices(ctx: RenderContext): void {
    const key = this.contextServicesKey(ctx);
    const services = this.contextServices.get(key);
    if (services) this.disposeContextServices(key, services);
  }

  private disposeContextServices(key: string, services: RendererContextServices): void {
    if (this.contextServices.get(key) !== services) return;
    this.contextServices.delete(key);
    services.componentRegistry.clear();
    services.virtualModules.clear();
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

type ColdProjectCacheInvalidator = (projectId: string) => Promise<boolean>;

async function invalidateConfiguredColdProjectCache(projectId: string): Promise<boolean> {
  const proxyMode = getEnvBoolean("PROXY_MODE", false, {
    trueValues: ["1"],
    trim: false,
    caseSensitive: true,
  });
  if (!proxyMode || !getEnvString("VERYFRONT_API_BASE_URL")) return false;

  const { APICacheStore } = await import("./cache/stores/api-store.ts");
  const store = new APICacheStore({
    keyPrefix: "render",
    ttlSeconds: 3_600,
    localMaxEntries: 1,
    enableLocalCache: false,
  });
  try {
    await store.deleteByPrefix(`${encodeURIComponent(projectId)}:`);
    return true;
  } finally {
    await store.destroy();
  }
}

let coldProjectCacheInvalidator: ColdProjectCacheInvalidator = invalidateConfiguredColdProjectCache;

/** @internal Dependency seam for cold-pod authoritative invalidation tests. */
export function setColdProjectCacheInvalidatorForTesting(
  invalidator?: ColdProjectCacheInvalidator,
): void {
  coldProjectCacheInvalidator = invalidator ?? invalidateConfiguredColdProjectCache;
}

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
  const initialization: Promise<Renderer> = (async () => {
    await nextRenderer.initialize(options?.shared);
    if (generation !== rendererGeneration) {
      await nextRenderer.destroy();
      throw INITIALIZATION_ERROR.create({
        detail: "Renderer initialization was cancelled before it completed.",
      });
    }
    renderer = nextRenderer;
    return nextRenderer;
  })();
  rendererInitializationPromise = initialization;
  try {
    return await initialization;
  } finally {
    if (rendererInitializationPromise === initialization) {
      rendererInitializationPromise = null;
    }
  }
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
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new TypeError("Project cache invalidation requires a non-empty projectId");
  }
  logger.debug("clearRendererCacheForProject called", {
    projectId,
    hasRenderer: !!renderer,
  });

  if (!renderer) {
    const invalidated = await coldProjectCacheInvalidator(projectId);
    logger.debug("Cold renderer project cache invalidation complete", {
      projectId,
      authoritativeStoreConfigured: invalidated,
    });
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
