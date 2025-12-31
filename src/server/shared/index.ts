/**
 * Shared Server Utilities
 *
 * Common utilities and factories used across server handlers.
 *
 * @module server/shared
 */

export {
  cleanupRenderers,
  createRendererPromise,
  getRenderer,
  getRendererCount,
} from "./renderer-factory.ts";
