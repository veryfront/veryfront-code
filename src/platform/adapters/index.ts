/**
 * Platform Adapters
 *
 * @module platform/adapters
 */

// Core types from base.ts — only the frequently-imported interfaces/types
export type {
  DirEntry,
  EnvironmentAdapter,
  FileChangeEvent,
  FileChangeKind,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  FileWatcherAdapter,
  KVStoreAdapter,
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeId,
  ServeOptions,
  Server,
  ServerAdapter,
  ShellAdapter,
  WatchOptions,
  WebSocketUpgrade,
} from "./base.ts";

// Detection & registry
export { detectRuntime } from "./detect.ts";
export { getAdapter } from "./detect.ts";
export { getLocalAdapter, resetLocalAdapter, runtime } from "./registry.ts";

// Mock adapter (testing)
export { createMockAdapter } from "./mock.ts";
export type { MockRuntimeAdapter } from "./mock.ts";

// Runtime adapters — selective (consumers use deep paths for full surface)
export { DenoAdapter, denoAdapter } from "./deno.ts";
export {
  BunAdapter,
  bunAdapter,
  BunEnvironmentAdapter,
  BunFileSystemAdapter,
  BunServer,
  BunServerAdapter,
} from "./bun.ts";
export type { BunFile, BunNamespace, BunServeOptions, BunServerType } from "./bun.ts";
export {
  createNodeServer,
  NodeAdapter,
  nodeAdapter,
  NodeEnvironmentAdapter,
  NodeFileSystemAdapter,
  NodeServer,
  NodeServerAdapter,
} from "./node.ts";
export type { NodeHttpServer, NodeIncomingMessage, NodeServerResponse } from "./node.ts";

// Security namespace
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
  API_CLIENT_ERROR,
  type FileContext,
  type FileDetail,
  type FileListResult,
  type ListFilesOptions,
  type LookupDomainResponse,
  type Project,
  type ProjectFile,
  VeryfrontApiClient,
  type VeryfrontAPIConfig,
  VeryfrontError,
} from "./veryfront-api-client/index.ts";

export {
  createTokenStorageAdapter,
  getTokenStorageAdapter,
  getTokenStorageType,
  isTokenStorageConfigured,
  MemoryTokenAdapter,
  resetTokenStorageAdapter,
  TOKEN_STORAGE_ERROR,
  type TokenStorageAdapter,
  type TokenStorageAdapterConfig,
  TokenStorageApiClient,
  VeryfrontTokenAdapter,
  type VeryfrontTokenConfig,
} from "./token/index.ts";

export {
  type AsyncAdapterFallback,
  createAdapterFallback,
  createAdapterFallbackSync,
  FALLBACK_EXHAUSTED,
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
