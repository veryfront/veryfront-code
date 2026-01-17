/**
 * Rendering Context Module
 *
 * Provides per-request context management for the universal renderer.
 * This module ensures tenant isolation by encapsulating all project-specific
 * data in a RenderContext that's passed through the rendering pipeline.
 *
 * @module rendering/context
 */

export {
  createCacheKey,
  createRenderContext,
  type CreateRenderContextOptions,
  isSameTenant,
  parseCacheKey,
  type RenderContext,
  type RenderEnvironment,
} from "./render-context.ts";
