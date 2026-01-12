/**
 * Shared Renderer Factory
 *
 * Re-export from modular implementation for backward compatibility.
 *
 * @module server/shared/renderer-factory
 */

export {
  // Types
  type CachedRenderer,
  // Memory
  checkAndEvictUnderMemoryPressure,
  // Lifecycle
  cleanupRenderers,
  clearProjectCachesAfterRender,
  // Main API
  createRendererPromise,
  destroyRenderer,
  // Cache
  evictExpired,
  evictLRU,
  evictProjectRenderer,
  getCacheKey,
  getRenderer,
  getRendererCacheStats,
  getRendererCount,
  getRendererForProject,
  // Constants
  MAX_RENDERER_CACHE_SIZE,
  MEMORY_CHECK_INTERVAL_MS,
  MEMORY_PRESSURE_CRITICAL,
  MEMORY_PRESSURE_WARNING,
  RENDERER_TTL_MS,
  type RendererInstance,
  type RendererPromise,
  shouldRejectDueToMemory,
  startPeriodicMemoryCheck,
  stopPeriodicMemoryCheck,
  triggerMemoryCheck,
} from "./renderer/index.ts";
