/**
 * Cache Backend - Re-exports from split modules.
 *
 * This file preserves backward compatibility for all existing imports.
 * Actual implementations live in ./backends/ directory:
 *   - backends/memory.ts  — MemoryCacheBackend
 *   - extension contract — optional distributed backend
 *   - backends/api.ts     — ApiCacheBackend
 *   - backends/factory.ts — createCacheBackend, CacheBackends, etc.
 *
 * @module cache/backend
 */

// Re-export everything from the backends barrel
export {
  ApiCacheBackend,
  type CacheBackendConfig,
  CacheBackends,
  createCacheBackend,
  createDistributedCacheAccessor,
  createDistributedCodeCacheAccessor,
  createTokenizingGateway,
  DiskCacheBackend,
  getRuntimeCacheBackendSelection,
  isApiCacheAvailable,
  isDiskCacheConfigured,
  isDistributedBackend,
  MemoryCacheBackend,
  type RuntimeCacheBackendSelection,
} from "./backends/index.ts";

// Re-export types
export type { CacheBackend } from "./types.ts";
export type { CodeCacheGateway, TokenizingCacheGateway } from "./backends/index.ts";
