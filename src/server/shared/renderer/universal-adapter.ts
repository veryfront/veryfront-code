/**
 * Universal Renderer Adapter
 *
 * Adapts the UniversalRenderer to work with the existing renderer factory API.
 * When UNIVERSAL_RENDERER=1 is set, this adapter is used instead of creating
 * per-project renderer instances.
 *
 * @module server/shared/renderer/universal-adapter
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { clearConfigCache, getConfig } from "@veryfront/config";
import type { HandlerContext } from "../../handlers/types.ts";
import {
  createRenderContext,
  getUniversalRenderer,
  initializeUniversalRenderer,
  isUniversalRendererInitialized,
  type RenderContext,
  UniversalRenderer,
} from "../../../rendering/universal-renderer.ts";
import type {
  PageDataResponse,
  RenderOptions,
  RenderResult,
} from "../../../rendering/orchestrator/types.ts";
import type { MdxBundle } from "@veryfront/types";

/**
 * Minimal renderer interface that handlers actually use.
 *
 * This interface defines the subset of VeryfrontRenderer's API that
 * handlers depend on, allowing the UniversalRendererAdapter to be
 * used interchangeably.
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
 * Check if universal renderer mode is enabled via environment variable
 */
export function isUniversalRendererEnabled(): boolean {
  // Check for UNIVERSAL_RENDERER=1 or UNIVERSAL_RENDERER=true
  const envValue = Deno.env.get("UNIVERSAL_RENDERER");
  return envValue === "1" || envValue === "true";
}

/**
 * Universal renderer initialization state
 */
let universalRendererInitPromise: Promise<UniversalRenderer> | null = null;

/**
 * Get or initialize the universal renderer
 *
 * This is idempotent - multiple calls will return the same instance.
 */
async function getOrInitUniversalRenderer(): Promise<UniversalRenderer> {
  if (isUniversalRendererInitialized()) {
    return getUniversalRenderer();
  }

  if (universalRendererInitPromise) {
    return universalRendererInitPromise;
  }

  logger.info("[UniversalAdapter] Initializing universal renderer");
  universalRendererInitPromise = initializeUniversalRenderer();

  try {
    return await universalRendererInitPromise;
  } finally {
    universalRendererInitPromise = null;
  }
}

/**
 * Create a render context from handler context, loading config if needed
 *
 * @param ctx - Handler context
 * @returns Fully populated render context
 */
async function createContextFromHandler(ctx: HandlerContext): Promise<RenderContext> {
  // Load config if not already loaded
  let config = ctx.config;
  if (!config) {
    logger.debug("[UniversalAdapter] Loading config for context");
    clearConfigCache();
    config = await getConfig(ctx.projectDir, ctx.adapter);
  }

  // Create context with loaded config
  const handlerWithConfig = { ...ctx, config };
  return createRenderContext(handlerWithConfig);
}

/**
 * Adapter that wraps the UniversalRenderer to provide the RendererAdapter interface
 *
 * This allows the universal renderer to be used transparently with the existing
 * handler code that expects a renderer instance.
 */
export class UniversalRendererAdapter implements RendererAdapter {
  private renderer: UniversalRenderer;
  private ctx: RenderContext;

  constructor(renderer: UniversalRenderer, ctx: RenderContext) {
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
      logger.warn("[UniversalAdapter] Failed to clear cache", { error: String(err), slug });
    });
  }

  clearAllState(): void {
    this.clearCache();
  }

  getVirtualModuleSystem() {
    // The universal renderer creates virtual modules per-request
    // This is a compatibility shim for handlers that access this
    logger.warn(
      "[UniversalAdapter] getVirtualModuleSystem called - not supported in universal mode",
    );
    return {
      handleRequest: () => null,
      register: () => Promise.resolve(""),
      registerModule: () => Promise.resolve(""),
      getModule: () => undefined,
      clear: () => {},
    };
  }

  async initializeComponents(): Promise<void> {
    // Components are initialized per-request in universal mode
    // This is a no-op for compatibility
  }

  async compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<import("@veryfront/types").MdxBundle> {
    // MDX compilation is handled internally by the universal renderer
    // This is a compatibility shim
    const { MDXCompiler } = await import("../../../rendering/orchestrator/mdx.ts");
    const { MDXCacheAdapter } = await import("@veryfront/transforms/mdx/index.ts");

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
    // The universal renderer is shared - don't destroy it here
    // Individual adapter instances just release their context reference
  }
}

/**
 * Get a renderer instance for a project using the universal renderer
 *
 * This creates a lightweight adapter that wraps the shared universal renderer
 * with the specific project context.
 *
 * @param ctx - Handler context
 * @returns Renderer adapter
 */
export async function getRendererForProjectUniversal(
  ctx: HandlerContext,
): Promise<RendererAdapter> {
  const startTime = performance.now();

  // Get or initialize the universal renderer (shared, ~100ms first time, instant after)
  const renderer = await getOrInitUniversalRenderer();

  // Create context for this project (~1ms)
  const renderCtx = await createContextFromHandler(ctx);

  const duration = performance.now() - startTime;
  logger.debug("[UniversalAdapter] Created renderer adapter", {
    projectId: renderCtx.projectId,
    projectSlug: renderCtx.projectSlug,
    duration: `${duration.toFixed(2)}ms`,
  });

  // Return an adapter that binds the universal renderer to this context
  return new UniversalRendererAdapter(renderer, renderCtx);
}

/**
 * Destroy the universal renderer (for cleanup/testing)
 */
export async function destroyUniversalRendererAdapter(): Promise<void> {
  const { destroyUniversalRenderer } = await import("../../../rendering/universal-renderer.ts");
  await destroyUniversalRenderer();
  universalRendererInitPromise = null;
}
