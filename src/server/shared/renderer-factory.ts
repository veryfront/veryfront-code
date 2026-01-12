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
  type RendererInstance,
  type RendererPromise,
  // Constants
  MAX_RENDERER_CACHE_SIZE,
  MEMORY_CHECK_INTERVAL_MS,
  MEMORY_PRESSURE_CRITICAL,
  MEMORY_PRESSURE_WARNING,
  RENDERER_TTL_MS,
  // Lifecycle
  cleanupRenderers,
  destroyRenderer,
  evictProjectRenderer,
  // Memory
  checkAndEvictUnderMemoryPressure,
  clearProjectCachesAfterRender,
  shouldRejectDueToMemory,
  startPeriodicMemoryCheck,
  stopPeriodicMemoryCheck,
  triggerMemoryCheck,
  // Cache
  evictExpired,
  evictLRU,
  getCacheKey,
  // Main API
  createRendererPromise,
  getRenderer,
  getRendererCacheStats,
  getRendererCount,
  getRendererForProject,
} from "./renderer/index.ts";
