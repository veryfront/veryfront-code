/**
 * Shared - Renderer
 *
 * @module server/shared/renderer
 */

export {
  destroyRendererAdapter,
  getRendererForProject,
  setRendererInitializer,
  type RendererAdapter,
  type RendererInitializer,
} from "./adapter.ts";
export { shouldRejectDueToMemory } from "./memory/pressure.ts";
