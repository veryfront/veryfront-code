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
import type { HandlerContext } from "../../handlers/types.ts";
import {
  createRenderContext,
  destroyRenderer as destroySharedRenderer,
  getRenderer,
  initializeRenderer,
  isRendererInitialized,
  type RenderContext,
  Renderer,
} from "../../../rendering/renderer.ts";
import type {
  PageDataResponse,
  RenderOptions,
  RenderResult,
} from "../../../rendering/orchestrator/types.ts";
import type { MdxBundle } from "#veryfront/types";

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
 */
async function getOrInitRenderer(): Promise<Renderer> {
  if (isRendererInitialized()) {
    return getRenderer();
  }

  if (rendererInitPromise) {
    return rendererInitPromise;
  }

  logger.info("[RendererAdapter] Initializing renderer");
  rendererInitPromise = initializeRenderer();

  try {
    return await rendererInitPromise;
  } finally {
    rendererInitPromise = null;
  }
}

/**
 * Create a render context from handler context, loading config if needed.
 *
 * IMPORTANT: For proxy mode (API-backed) projects, ctx.config is intentionally
 * set to undefined to signal that we should load the project-specific config
 * from the API. We use projectId or projectSlug as the cache key to ensure
 * correct per-project config caching.
 */
async function createContextFromHandler(ctx: HandlerContext): Promise<RenderContext> {
  let config = ctx.config;

  if (!config) {
    // Load config from API adapter (for proxy mode projects)
    // Use projectId/projectSlug as cache key since projectDir is shared across all API-backed projects
    const cacheKey = ctx.projectId || ctx.projectSlug;
    logger.debug("[RendererAdapter] Loading config from adapter", {
      projectDir: ctx.projectDir,
      projectSlug: ctx.projectSlug,
      projectId: ctx.projectId,
      cacheKey,
    });
    config = await getConfig(ctx.projectDir, ctx.adapter, { cacheKey });
  }

  return createRenderContext({ ...ctx, config });
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

  // Get or initialize the renderer (shared, ~100ms first time, instant after)
  const renderer = await getOrInitRenderer();

  // Create context for this project (~1ms)
  const renderCtx = await createContextFromHandler(ctx);

  const duration = performance.now() - startTime;
  logger.debug("[RendererAdapter] Created renderer adapter", {
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
