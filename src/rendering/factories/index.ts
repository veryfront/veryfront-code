/**
 * Service Factories Module
 *
 * Provides factory functions for creating context-bound services.
 * These services are created per-request for tenant isolation.
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
