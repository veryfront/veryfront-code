/**
 * Cache Module
 *
 * Rendering cache coordination and storage backends.
 * Provides cache coordination logic and pluggable store implementations.
 *
 * @example
 * ```typescript
 * import { CacheCoordinator, MemoryCacheStore } from '@veryfront/rendering/cache'
 *
 * const store = new MemoryCacheStore({ maxSize: 100 })
 * const coordinator = new CacheCoordinator({ store, ttl: 3600 })
 *
 * // Check cache
 * const result = await coordinator.checkCache(key)
 * if (!result) {
 *   // Render and persist
 *   await coordinator.persistResult(result, slug, key, metadata)
 * }
 * ```
 *
 * @module rendering/cache
 */

// Cache coordinator
export {
  CacheCoordinator,
  type CacheCoordinatorOptions,
  type CacheLookupResult,
} from "./cache-coordinator.ts";

// Cache types
export type { CachePayload, CacheStore } from "./types.ts";

// Re-export cache stores
export * from "./stores/index.ts";
