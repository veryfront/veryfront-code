/**
 * Shared Server Utilities
 *
 * Common utilities and factories used across server handlers.
 *
 * @module server/shared
 */

export {
  getRenderer,
  createRendererPromise,
  cleanupRenderers,
  getRendererCount,
} from "./renderer-factory.ts";
