/**
 * Server Shared
 *
 * @module server/shared
 */

export {
  destroyRendererAdapter,
  getRendererForProject,
  type RendererAdapter,
  shouldRejectDueToMemory,
} from "./renderer-factory.ts";
