export * from "./base.ts";
export * from "./detect.ts";
export { getLocalAdapter, runtime } from "./registry.ts";

export * from "./mock.ts";

export * from "./bun.ts";
export * from "./node.ts";
export * from "./deno.ts";

export * as security from "./security/index.ts";

export {
  createFSAdapter,
  createFSAdapterFromConfig,
  enhanceAdapterWithFS,
  FSAdapterWrapper,
  getFSAdapterType,
  isExtendedFSAdapter,
  isFSAdapterConfigured,
  NotSupportedError,
  VeryfrontFSAdapter,
  wrapFSAdapter,
} from "./fs/index.ts";

export type {
  CacheStats,
  DirectoryEntry,
  ExtendedFileSystemAdapter,
  FSAdapter,
  FSAdapterConfig,
  VeryfrontFSState,
} from "./fs/index.ts";

export {
  type FileContext,
  type FileDetail,
  type FileListResult,
  type ListFilesOptions,
  type LookupDomainResponse,
  type Project,
  type ProjectFile,
  VeryfrontAPIClient,
  type VeryfrontAPIConfig,
  VeryfrontAPIError,
} from "./veryfront-api-client/index.ts";

export {
  createTokenStorageAdapter,
  getTokenStorageAdapter,
  getTokenStorageType,
  isTokenStorageConfigured,
  MemoryTokenAdapter,
  resetTokenStorageAdapter,
  type TokenStorageAdapter,
  type TokenStorageAdapterConfig,
  TokenStorageAPIClient,
  TokenStorageError,
  VeryfrontTokenAdapter,
  type VeryfrontTokenConfig,
} from "./token/index.ts";

export {
  type AsyncAdapterFallback,
  createAdapterFallback,
  createAdapterFallbackSync,
  FallbackExecutionError,
  type FallbackOptions,
  type SyncAdapterFallback,
  withFallback,
  withFallbackSync,
} from "./fallback-wrapper.ts";

export {
  arrayToObject,
  clearModuleCache,
  DenoRedisAdapter,
  type DenoRedisClient,
  type DenoRedisModule,
  getRedisModule,
  NodeRedisAdapter,
  type NodeRedisClient,
  type NodeRedisModule,
  type RedisAdapter,
} from "./redis/index.ts";
