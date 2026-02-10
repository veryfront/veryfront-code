/**
 * Cache Backend - Re-exports from split modules.
 *
 * This file preserves backward compatibility for all existing imports.
 * Actual implementations live in ./backends/ directory:
 *   - backends/memory.ts  — MemoryCacheBackend
 *   - backends/redis.ts   — RedisCacheBackend
 *   - backends/api.ts     — APICacheBackend
 *   - backends/factory.ts — createCacheBackend, CacheBackends, etc.
 *
 * @module cache/backend
 */

// Re-export everything from the backends barrel
export {
  APICacheBackend,
  type CacheBackendConfig,
  CacheBackends,
  createCacheBackend,
  createDistributedCacheAccessor,
  createDistributedCodeCacheAccessor,
  createTokenizingGateway,
  isApiCacheAvailable,
  isDistributedBackend,
  MemoryCacheBackend,
  RedisCacheBackend,
} from "./backends/index.ts";

// Re-export types
export type { CacheBackend } from "./types.ts";
export type { CodeCacheGateway, TokenizingCacheGateway } from "./backends/index.ts";
