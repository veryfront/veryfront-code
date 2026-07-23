/**
 * Rendering Factories
 *
 * @module rendering/factories
 */

export {
  type ContextBoundServices,
  createComponentRegistry,
  createContextBoundServices,
  createLayoutCollector,
  createLayoutCompiler,
  createPageRenderer,
  type CreatePageRendererOptions,
  createPageResolver,
  createSSRRenderer,
  createVirtualModuleSystem,
} from "./service-factories.ts";
