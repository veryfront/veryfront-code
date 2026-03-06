/**
 * Repository pattern for data access — filesystem and cache backends,
 * multi-tier cache coordination, and context/stats tracking per request.
 *
 * @module repositories
 */

export type {
  CacheRepository,
  CacheRepositoryOptions,
  CacheStats,
  FileSystemRepository,
  RepositoryContext,
} from "./types.ts";

export {
  createFileSystemRepository,
  SecureFsRepository,
  type SecureFsRepositoryConfig,
} from "./filesystem/index.ts";

export {
  buildScopedKey,
  createMemoryCacheRepository,
  createMultiTierCacheRepository,
  MemoryCacheRepository,
  MultiTierCacheRepository,
} from "./cache/index.ts";

export {
  createRepositoryContext,
  createRepositoryFactory,
  extractRepositoryContext,
  RepositoryFactory,
  type RepositoryFactoryConfig,
} from "./factory.ts";
