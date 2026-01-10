// FS Adapters
export { VeryfrontFSAdapter } from "./veryfront/index.ts";
export { GitHubFSAdapter } from "./github/index.ts";

// Types
export type {
  CacheStats,
  DirectoryEntry,
  FSAdapter,
  FSAdapterConfig,
  VeryfrontConfig,
  VeryfrontFSState,
} from "./veryfront/types.ts";

// Factory and utilities
export { createFSAdapter } from "./factory.ts";
export {
  FSAdapterWrapper,
  isExtendedFSAdapter,
  NotSupportedError,
  wrapFSAdapter,
} from "./wrapper.ts";
export type { ExtendedFileSystemAdapter } from "./wrapper.ts";
export {
  createFSAdapterFromConfig,
  enhanceAdapterWithFS,
  getFSAdapterType,
  isFSAdapterConfigured,
} from "./integration.ts";

// Multi-project support
export { MultiProjectFSAdapter } from "./veryfront/multi-project-adapter.ts";
export { ProxyFSAdapterManager } from "./veryfront/proxy-manager.ts";

// Cache
export { FileCache } from "./cache/file-cache.ts";
export type { FileCacheOptions } from "./cache/types.ts";
