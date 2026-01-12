/**
 * Cache Key Generation
 *
 * Generates cache keys for renderer instances.
 *
 * @module server/shared/renderer/cache/key-generation
 */

import type { HandlerContext } from "../../../handlers/types.ts";
import { isProductionMode } from "../../../handlers/request/ssr/ssr-handler.ts";

/**
 * Get the cache key for a project.
 * Includes environment and releaseId to ensure fresh content after deployments.
 *
 * IMPORTANT: This must use the same production mode logic as the SSR handler
 * to ensure consistency between renderer cache keys and adapter content contexts.
 */
export function getCacheKey(ctx: HandlerContext): string | null {
  const projectSlug = ctx.projectSlug;
  if (!projectSlug) return null;

  // Use isProductionMode for consistency with SSR handler's runWithContext() call.
  // This ensures the renderer cache key matches the adapter's content context.
  const isProduction = isProductionMode(ctx);
  if (isProduction) {
    return `${projectSlug}:production:${ctx.releaseId ?? "latest"}`;
  }
  return `${projectSlug}:preview`;
}
