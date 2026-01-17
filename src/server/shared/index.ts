/**
 * Shared Server Utilities
 *
 * Common utilities and factories used across server handlers.
 *
 * @module server/shared
 */

export {
  destroyRendererAdapter,
  getRendererForProject,
  type RendererAdapter,
  shouldRejectDueToMemory,
} from "./renderer-factory.ts";
