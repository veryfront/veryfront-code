/**
 * Renderer Manager
 *
 * Manages renderer lifecycle and initialization for module handlers.
 * Implements singleton pattern to ensure single renderer instance per handler.
 *
 * @module server/handlers/request/module/renderer-manager
 */

import { createRenderer } from "@veryfront/rendering/index.ts";
import type { HandlerContext } from "../../types.ts";

/**
 * Gets or creates a renderer instance for the given context.
 * Uses lazy initialization with singleton pattern.
 *
 * @param ctx - Handler context containing project configuration
 * @param rendererInit - Optional existing renderer promise (for caching)
 * @returns Promise resolving to renderer instance
 *
 * @example
 * ```ts
 * const renderer = await getRenderer(ctx, this.rendererInit);
 * const result = await renderer.renderPage(slug, options);
 * ```
 */
export async function getRenderer(
  ctx: HandlerContext,
  rendererInit?: Promise<Awaited<ReturnType<typeof createRenderer>>> | null,
): Promise<Awaited<ReturnType<typeof createRenderer>>> {
  if (!rendererInit) {
    rendererInit = createRenderer({
      projectDir: ctx.projectDir,
      mode: ctx.mode,
      adapter: ctx.adapter,
      moduleServerUrl: ctx.moduleServerUrl,
    });
  }
  return await rendererInit;
}
