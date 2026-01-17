/**
 * Shared Renderer
 *
 * Provides the renderer adapter for handlers. The renderer is initialized
 * once at startup and shared across all projects, with per-request context
 * providing tenant isolation.
 *
 * @module server/shared/renderer
 */

// Re-export types and functions from adapter
export { destroyRendererAdapter, getRendererForProject, type RendererAdapter } from "./adapter.ts";

// Re-export memory utilities
export { shouldRejectDueToMemory } from "./memory/pressure.ts";
