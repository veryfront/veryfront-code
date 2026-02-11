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
  createProviderManager,
  createSSRRenderer,
  createVirtualModuleSystem,
} from "./service-factories.ts";
