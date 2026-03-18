/**
 * Shared - Renderer
 *
 * @module server/shared/renderer
 */

export {
  destroyRendererAdapter,
  getRendererForProject,
  type RendererAdapter,
  type RendererInitializer,
  setRendererInitializer,
} from "./adapter.ts";
export { shouldRejectDueToMemory } from "./memory/pressure.ts";
