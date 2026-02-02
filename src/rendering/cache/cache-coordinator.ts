/**
 * Cache Coordinator Interfaces
 *
 * Defines the interface for cache coordination in the rendering pipeline.
 * The primary implementation is ContextAwareCacheCoordinator in rendering/shared/.
 *
 * @module rendering/cache/cache-coordinator
 */

import type { RenderResult } from "../orchestrator/types.ts";

/**
 * Result from checking the cache for a render result.
 */
export interface CacheLookupResult {
  cachedResult?: RenderResult;
  depAwareSlug: string;
  moduleCacheKey: string;
  cachedModule?: RenderResult["pageModule"];
}

/**
 * Simple cache coordinator interface for the rendering pipeline.
 * This interface is implemented by adapters wrapping ContextAwareCacheCoordinator.
 */
export interface SimpleCacheCoordinator {
  checkCache(slug: string, cacheKey?: string): Promise<CacheLookupResult>;
  persistResult(result: RenderResult, slug: string, cacheKey?: string): Promise<void>;
  clearAll(): Promise<void>;
  clearSlug(slug: string): Promise<void>;
  destroy(): Promise<void>;
}
