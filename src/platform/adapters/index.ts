// Base types
export * from "./base.ts";

// Runtime detection
export * from "./detect.ts";
export { getLocalAdapter, runtime } from "./registry.ts";

// Mock adapter
export * from "./mock.ts";

// Runtime adapters (re-export for backwards compatibility)
export * from "./bun.ts";
export * from "./node.ts";
export * from "./deno.ts";

// Security
export * as security from "./security/index.ts";

// FS Adapters
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
  VeryfrontConfig,
  VeryfrontFSState,
} from "./fs/index.ts";

// Veryfront API Client
export {
  type ListFilesResponse,
  type ListProjectsResponse,
  type Project,
  type ProjectFile,
  VeryfrontAPIClient,
  type VeryfrontAPIConfig,
  VeryfrontAPIError,
} from "./veryfront-api-client/index.ts";

// Token Storage
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

// Fallback utilities
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
