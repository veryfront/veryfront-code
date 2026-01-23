/**
 * Renderer Adapter
 *
 * Adapts the shared Renderer to work with handler contexts.
 * Creates lightweight adapters that bind the shared renderer
 * to a specific project context.
 *
 * @module server/shared/renderer/adapter
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { getConfig } from "#veryfront/config";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import type { HandlerContext } from "../../handlers/types.ts";
import { buildEnrichedContext } from "../../context/enriched-context.ts";
import {
  createRenderContextFromEnriched,
  destroyRenderer as destroySharedRenderer,
  getRenderer,
  initializeRenderer,
  isRendererInitialized,
  type RenderContext,
  Renderer,
  type RendererOptions,
} from "../../../rendering/renderer.ts";
import type {
  PageDataResponse,
  RenderOptions,
  RenderResult,
} from "../../../rendering/orchestrator/types.ts";
import type { MdxBundle } from "#veryfront/types";
import { APICacheStore } from "../../../rendering/cache/stores/api-store.ts";

/**
 * Minimal renderer interface that handlers actually use.
 *
 * This interface defines the subset of the Renderer API that
 * handlers depend on, allowing adapters to be used interchangeably.
 */
export interface RendererAdapter {
  renderPage(slug: string, options?: RenderOptions): Promise<RenderResult>;
  resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse>;
  getAllPages(): Promise<string[]>;
  clearCache(slug?: string): void;
  clearAllState(): void;
  getVirtualModuleSystem(): {
    handleRequest(req: Request): Response | null;
    register(id: string, source: string, projectDir: string): Promise<string>;
    registerModule(id: string, source: string, projectDir: string): Promise<string>;
    getModule(id: string): unknown;
    clear(): void;
  };
  initializeComponents(): Promise<void>;
  compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MdxBundle>;
  destroy(): Promise<void>;
}

/**
 * Renderer initialization state
 */
let rendererInitPromise: Promise<Renderer> | null = null;

/**
 * Get or initialize the renderer
 *
 * This is idempotent - multiple calls will return the same instance.
 * In proxy mode (production), uses API-backed distributed cache for
 * cross-pod render result sharing.
 */
async function getOrInitRenderer(): Promise<Renderer> {
  if (isRendererInitialized()) {
    return getRenderer();
  }

  if (rendererInitPromise) {
    return rendererInitPromise;
  }

  // Check if we're in proxy mode (production K8s deployment)
  // In proxy mode, use distributed API cache for cross-pod sharing
  const isProxyMode = getEnv("PROXY_MODE") === "1";

  const options: RendererOptions = {};

  if (isProxyMode) {
    // Use API-backed distributed cache for render results
    // This enables: Pod A renders → Pod B serves from cache
    logger.debug("[RendererAdapter] Using API-backed distributed render cache");
    options.cache = {
      store: new APICacheStore({
        keyPrefix: "render",
        ttlSeconds: 3600, // 1 hour TTL
        localMaxEntries: 200, // Local memory cache for fast reads
      }),
    };
  }

  logger.debug("[RendererAdapter] Initializing renderer", {
    proxyMode: isProxyMode,
    cacheType: isProxyMode ? "api-distributed" : "memory",
  });

  rendererInitPromise = initializeRenderer(options);

  try {
    return await rendererInitPromise;
  } finally {
    rendererInitPromise = null;
  }
}

/**
 * Create a render context from handler context, loading config if needed.
 *
 * Fast path: If ctx.enriched is present (built in universal-handler), use it directly.
 * This avoids redundant config loading and computation.
 *
 * Slow path (proxy mode): ctx.config is intentionally set to undefined to signal
 * that we should load the project-specific config from the API. We then build
 * EnrichedContext after config is loaded.
 */
async function createContextFromHandler(ctx: HandlerContext): Promise<RenderContext> {
  const projectSlug = ctx.projectSlug || "unknown";

  // Fast path: EnrichedContext already built (local projects)
  if (ctx.enriched) {
    logger.debug("[RendererAdapter] Using pre-built EnrichedContext", { projectSlug });
    return createRenderContextFromEnriched(ctx.enriched);
  }

  // Slow path: Need to load config and build context (proxy mode)
  let config = ctx.config;

  if (!config) {
    // Load config from API adapter (for proxy mode projects)
    // Use projectId/projectSlug as cache key since projectDir is shared across all API-backed projects
    const cacheKey = ctx.projectId || ctx.projectSlug;
    logger.debug("[RendererAdapter] Loading config from adapter START", {
      projectDir: ctx.projectDir,
      projectSlug,
      projectId: ctx.projectId,
      cacheKey,
    });
    const configStartTime = performance.now();
    config = await getConfig(ctx.projectDir, ctx.adapter, { cacheKey });
    logger.debug("[RendererAdapter] Loading config from adapter DONE", {
      projectSlug,
      duration: `${(performance.now() - configStartTime).toFixed(2)}ms`,
    });
  }

  // Build EnrichedContext now that we have config
  // This ensures consistent context throughout the pipeline
  const contextStartTime = performance.now();

  // Use resolvedEnvironment from HandlerContext (set by universal-handler from proxyEnv/domain lookup)
  // Falls back to parsedDomain.environment mapping, then requestContext.mode
  // This ensures staging/development domains are treated as preview even when
  // resolvedEnvironment isn't set (e.g., tests or internal callers)
  let resolvedEnvironment: "preview" | "production" = ctx.resolvedEnvironment ?? "preview";
  if (!ctx.resolvedEnvironment) {
    const domainEnv = ctx.parsedDomain?.environment;
    if (domainEnv === "staging" || domainEnv === "development" || domainEnv === "preview") {
      resolvedEnvironment = "preview";
    } else if (domainEnv === "production") {
      resolvedEnvironment = "production";
    } else {
      // Fall back to requestContext.mode
      resolvedEnvironment = ctx.requestContext?.mode ?? "preview";
    }
  }

  // Build EnrichedContext with all resolved data
  const enriched = buildEnrichedContext({
    projectId: ctx.projectId ?? ctx.projectSlug ?? "__single__",
    projectSlug: ctx.projectSlug ?? ctx.projectId ?? "__single__",
    projectDir: ctx.projectDir,
    token: ctx.proxyToken ?? "",
    environment: resolvedEnvironment,
    branch: ctx.requestContext?.branch ?? null,
    isLocalDev: ctx.requestContext?.isLocalDev ?? false,
    parsedDomain: ctx.parsedDomain ?? {
      slug: null,
      branch: null,
      environment: null,
      isVeryfrontDomain: false,
      isDraft: false,
      allowIframeEmbed: false,
    },
    adapter: ctx.adapter,
    config,
    releaseId: ctx.releaseId,
    environmentName: ctx.environmentName,
    moduleServerUrl: ctx.moduleServerUrl,
    debug: ctx.debug,
  });

  // Attach enriched back to ctx for potential downstream use
  // Note: This mutates ctx, but only in the slow path where enriched was undefined
  (ctx as { enriched?: typeof enriched }).enriched = enriched;

  const renderContext = createRenderContextFromEnriched(enriched);
  logger.debug("[RendererAdapter] createRenderContext DONE (built EnrichedContext)", {
    projectSlug,
    duration: `${(performance.now() - contextStartTime).toFixed(2)}ms`,
  });

  return renderContext;
}

/**
 * Adapter that wraps the shared Renderer to provide the RendererAdapter interface
 *
 * This allows the renderer to be used transparently with the existing
 * handler code that expects a renderer instance.
 */
class RendererAdapterImpl implements RendererAdapter {
  private renderer: Renderer;
  private ctx: RenderContext;

  constructor(renderer: Renderer, ctx: RenderContext) {
    this.renderer = renderer;
    this.ctx = ctx;
  }

  renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    return this.renderer.renderPage(slug, this.ctx, options);
  }

  resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse> {
    return this.renderer.resolvePageData(slug, this.ctx, options);
  }

  getAllPages(): Promise<string[]> {
    return this.renderer.getAllPages(this.ctx);
  }

  clearCache(slug?: string): void {
    // Fire and forget - the interface doesn't expect a promise
    this.renderer.clearCache(this.ctx, slug).catch((err) => {
      logger.warn("[RendererAdapter] Failed to clear cache", { error: String(err), slug });
    });
  }

  clearAllState(): void {
    this.clearCache();
  }

  getVirtualModuleSystem() {
    // Virtual modules are created per-request
    // This is a compatibility shim for handlers that access this
    logger.warn("[RendererAdapter] getVirtualModuleSystem called - not supported");
    return {
      handleRequest: () => null,
      register: () => Promise.resolve(""),
      registerModule: () => Promise.resolve(""),
      getModule: () => undefined,
      clear: () => {},
    };
  }

  async initializeComponents(): Promise<void> {
    // Components are initialized per-request
    // This is a no-op for compatibility
  }

  async compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MdxBundle> {
    // MDX compilation is handled internally by the renderer
    // This is a compatibility shim
    const { MDXCompiler } = await import("../../../rendering/orchestrator/mdx.ts");
    const { MDXCacheAdapter } = await import("#veryfront/transforms/mdx/index.ts");

    const mdxCacheAdapter = new MDXCacheAdapter({
      config: this.ctx.config,
      mode: this.ctx.mode,
    });

    const compiler = new MDXCompiler({
      projectDir: this.ctx.projectDir,
      mode: this.ctx.mode,
      mdxCacheAdapter,
    });

    return compiler.compileMDX(content, frontmatter, filePath);
  }

  async destroy(): Promise<void> {
    // The renderer is shared - don't destroy it here
    // Individual adapter instances just release their context reference
  }
}

/**
 * Get a renderer adapter for a project
 *
 * This creates a lightweight adapter that wraps the shared renderer
 * with the specific project context.
 *
 * @param ctx - Handler context
 * @returns Renderer adapter
 */
export async function getRendererForProject(ctx: HandlerContext): Promise<RendererAdapter> {
  const startTime = performance.now();
  const projectSlug = ctx.projectSlug || "unknown";

  logger.debug("[RendererAdapter] getRendererForProject START", {
    projectSlug,
    projectId: ctx.projectId,
    hasConfig: !!ctx.config,
  });

  // Get or initialize the renderer (shared, ~100ms first time, instant after)
  const rendererStartTime = performance.now();
  logger.debug("[RendererAdapter] getOrInitRenderer START", { projectSlug });
  const renderer = await getOrInitRenderer();
  logger.debug("[RendererAdapter] getOrInitRenderer DONE", {
    projectSlug,
    duration: `${(performance.now() - rendererStartTime).toFixed(2)}ms`,
  });

  // Create context for this project (~1ms)
  const contextStartTime = performance.now();
  logger.debug("[RendererAdapter] createContextFromHandler START", { projectSlug });
  const renderCtx = await createContextFromHandler(ctx);
  logger.debug("[RendererAdapter] createContextFromHandler DONE", {
    projectSlug,
    duration: `${(performance.now() - contextStartTime).toFixed(2)}ms`,
  });

  const duration = performance.now() - startTime;
  logger.debug("[RendererAdapter] getRendererForProject DONE", {
    projectId: renderCtx.projectId,
    projectSlug: renderCtx.projectSlug,
    duration: `${duration.toFixed(2)}ms`,
  });

  // Return an adapter that binds the renderer to this context
  return new RendererAdapterImpl(renderer, renderCtx);
}

/**
 * Destroy the shared renderer (for cleanup/testing)
 */
export async function destroyRendererAdapter(): Promise<void> {
  await destroySharedRenderer();
  rendererInitPromise = null;
}
