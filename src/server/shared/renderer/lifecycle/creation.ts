/**
 * Renderer Creation
 *
 * Internal renderer creation with logging and error handling.
 *
 * @module server/shared/renderer/lifecycle/creation
 */

import { createRenderer } from "@veryfront/rendering/index.ts";
import { rendererLogger } from "@veryfront/utils";
import type { VeryfrontConfig } from "@veryfront/config";
import type { HandlerContext } from "../../../handlers/types.ts";
import type { RendererInstance } from "../types.ts";

/**
 * Internal renderer creation with logging.
 * The config parameter should be pre-loaded by the caller while still in a valid
 * AsyncLocalStorage context. This avoids context loss issues with IIFE patterns.
 */
export async function createRendererInternal(
  ctx: HandlerContext,
  projectSlug: string,
  config?: VeryfrontConfig,
): Promise<RendererInstance> {
  rendererLogger.debug("[RendererFactory] Creating renderer", {
    projectSlug,
    mode: ctx.mode,
  });

  try {
    // Use the pre-loaded config if provided, otherwise fall back to ctx.config
    const rendererConfig = config ?? ctx.config;

    const renderer = await createRenderer({
      projectDir: ctx.projectDir,
      mode: ctx.mode,
      adapter: ctx.adapter,
      moduleServerUrl: ctx.moduleServerUrl,
      config: rendererConfig,
      // Pass projectId (UUID) for SSR cache isolation in multi-project mode
      projectId: ctx.projectId,
    });

    rendererLogger.debug("[RendererFactory] Renderer created", { projectSlug });
    return renderer;
  } catch (error) {
    rendererLogger.error("[RendererFactory] Renderer creation failed", {
      projectSlug,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
