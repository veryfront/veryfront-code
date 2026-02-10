// Re-export CacheBackend interface from types
export type { CacheBackend } from "../types.ts";

// Backend implementations
export { MemoryCacheBackend } from "./memory.ts";
export { RedisCacheBackend } from "./redis.ts";
export { APICacheBackend } from "./api.ts";

// Factory functions and config
export {
  type CacheBackendConfig,
  CacheBackends,
  createCacheBackend,
  createDistributedCacheAccessor,
  createDistributedCodeCacheAccessor,
  isApiCacheAvailable,
  isDistributedBackend,
} from "./factory.ts";

// Gateway re-exports
export type { CodeCacheGateway, TokenizingCacheGateway } from "./factory.ts";
export { createTokenizingGateway } from "./factory.ts";
