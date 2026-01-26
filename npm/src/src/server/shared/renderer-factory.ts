/**
 * Shared Renderer Factory
 *
 * Re-export from modular implementation for backward compatibility.
 *
 * @module server/shared/renderer-factory
 */

export {
  destroyRendererAdapter,
  getRendererForProject,
  type RendererAdapter,
  shouldRejectDueToMemory,
} from "./renderer/index.js";
