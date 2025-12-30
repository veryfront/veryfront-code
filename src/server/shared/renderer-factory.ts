/**
 * Shared Renderer Factory
 *
 * Provides centralized renderer lifecycle management with lazy initialization,
 * caching, and cleanup capabilities. Used by SSR and module handlers.
 *
 * @module server/shared/renderer-factory
 */

import type { HandlerContext } from "../handlers/types.ts";
import { createRenderer } from "@veryfront/rendering/index.ts";
import { rendererLogger } from "@veryfront/utils";

type RendererInstance = Awaited<ReturnType<typeof createRenderer>>;
type RendererPromise = Promise<RendererInstance>;

/**
 * Global registry of renderer instances for cleanup
 */
const rendererRegistry = new Set<RendererInstance>();

/**
 * Get or create renderer instance
 *
 * Uses lazy initialization pattern with promise caching to ensure
 * only one renderer is created even with concurrent requests.
 *
 * @param ctx - Handler context with projectDir, mode, adapter
 * @param rendererInit - Cached renderer initialization promise (optional)
 * @returns Renderer instance
 *
 * @example
 * ```typescript
 * // In handler class
 * private rendererInit: RendererPromise | null = null;
 *
 * async handle(ctx: HandlerContext) {
 *   if (!this.rendererInit) {
 *     this.rendererInit = getRenderer(ctx);
 *   }
 *   const renderer = await this.rendererInit;
 *   return renderer.renderPage(slug);
 * }
 * ```
 */
export async function getRenderer(
  ctx: HandlerContext,
  rendererInit?: RendererPromise | null,
): Promise<RendererInstance> {
  if (rendererInit) {
    return await rendererInit;
  }

  rendererLogger.debug("[RendererFactory] Creating renderer", {
    mode: ctx.mode,
    projectDir: ctx.projectDir,
  });

  try {
    const renderer = await createRenderer({
      projectDir: ctx.projectDir,
      mode: ctx.mode,
      adapter: ctx.adapter,
      moduleServerUrl: ctx.moduleServerUrl,
    });

    rendererRegistry.add(renderer);

    rendererLogger.debug("[RendererFactory] Renderer created successfully");
    return renderer;
  } catch (error) {
    rendererLogger.error("[RendererFactory] Renderer creation failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Create a new renderer promise for caching
 *
 * Returns a promise that can be stored and awaited multiple times.
 * Useful for handlers that want to cache the initialization promise.
 *
 * @param ctx - Handler context
 * @returns Promise resolving to renderer instance
 */
export function createRendererPromise(ctx: HandlerContext): RendererPromise {
  return getRenderer(ctx);
}

/**
 * Cleanup all cached renderer instances
 *
 * Destroys all renderer instances that were created, cleaning up
 * their internal resources (cache stores, intervals, etc.).
 * Should be called during test cleanup or server shutdown.
 *
 * @example
 * ```typescript
 * // In test cleanup
 * afterAll(async () => {
 *   await cleanupRenderers();
 * });
 * ```
 */
export async function cleanupRenderers(): Promise<void> {
  rendererLogger.debug("[RendererFactory] Cleaning up renderers", {
    count: rendererRegistry.size,
  });

  for (const renderer of rendererRegistry) {
    try {
      if (renderer && typeof renderer.destroy === "function") {
        await renderer.destroy();
      }
    } catch (error) {
      rendererLogger.warn("[RendererFactory] Error destroying renderer", { error });
    }
  }

  rendererRegistry.clear();

  rendererLogger.debug("[RendererFactory] Renderer cleanup complete");
}

/**
 * Get the current renderer count (for testing/debugging)
 */
export function getRendererCount(): number {
  return rendererRegistry.size;
}
