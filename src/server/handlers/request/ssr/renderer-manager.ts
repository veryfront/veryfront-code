/**
 * Renderer Manager
 *
 * Manages renderer lifecycle with lazy initialization and caching.
 * Ensures only one renderer instance is created per handler.
 *
 * @module server/handlers/request/ssr/renderer-manager
 */

import type { HandlerContext } from "../../types.ts";
import { createRenderer } from "@veryfront/rendering/index.ts";
import { rendererLogger } from "@veryfront/utils";

// Global registry of renderer instances for cleanup
const rendererRegistry = new Set<Awaited<ReturnType<typeof createRenderer>>>();

/**
 * Get or create renderer instance
 *
 * Uses lazy initialization pattern with promise caching to ensure
 * only one renderer is created even with concurrent requests.
 *
 * @param rendererInit - Cached renderer initialization promise
 * @param ctx - Handler context with projectDir, mode, adapter
 * @returns Renderer instance
 *
 * @example
 * ```typescript
 * const renderer = await getRenderer(this.rendererInit, ctx);
 * const result = await renderer.renderPage(slug);
 * ```
 */
export async function getRenderer(
  rendererInit: Promise<Awaited<ReturnType<typeof createRenderer>>> | null,
  ctx: HandlerContext,
): Promise<Awaited<ReturnType<typeof createRenderer>>> {
  if (!rendererInit) {
    rendererLogger.info("[SSRHandler] Creating renderer", {
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

      // Register renderer for cleanup
      rendererRegistry.add(renderer);

      rendererLogger.info("[SSRHandler] Renderer created successfully");
      return renderer;
    } catch (error) {
      rendererLogger.error("[SSRHandler] FATAL: Renderer creation failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }
  return await rendererInit;
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
 * await cleanupBundler();
 * ```
 */
export async function cleanupRenderers(): Promise<void> {
  rendererLogger.info("[RendererManager] Cleaning up renderers", {
    count: rendererRegistry.size,
  });

  for (const renderer of rendererRegistry) {
    try {
      if (renderer && typeof renderer.destroy === "function") {
        await renderer.destroy();
      }
    } catch (error) {
      rendererLogger.warn("[RendererManager] Error destroying renderer", { error });
    }
  }

  rendererRegistry.clear();

  rendererLogger.info("[RendererManager] Renderer cleanup complete");
}
