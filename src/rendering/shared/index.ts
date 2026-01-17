/**
 * Shared Renderer Services Module
 *
 * Provides services that can be safely shared across all projects
 * in a multi-tenant environment.
 *
 * @module rendering/shared
 */

// Shared services singleton
export {
  areSharedServicesInitialized,
  destroySharedServices,
  getSharedCompileMDX,
  getSharedServices,
  initializeSharedServices,
  setSharedCompileMDX,
  type SharedServices,
  type SharedServicesOptions,
} from "./shared-services.ts";

// Context-aware cache
export {
  ContextAwareCacheCoordinator,
  type ContextAwareCacheLookupResult,
  type ContextAwareCacheOptions,
} from "./context-aware-cache.ts";
