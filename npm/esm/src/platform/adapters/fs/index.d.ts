export { FileCache } from "./cache/file-cache.js";
export type { FileCacheOptions } from "./cache/types.js";
export { createFSAdapter } from "./factory.js";
export { createFSAdapterFromConfig, enhanceAdapterWithFS, getFSAdapterType, isFSAdapterConfigured, } from "./integration.js";
export { GitHubFSAdapter } from "./github/index.js";
export { VeryfrontFSAdapter } from "./veryfront/index.js";
export { MultiProjectFSAdapter } from "./veryfront/multi-project-adapter.js";
export { ProxyFSAdapterManager } from "./veryfront/proxy-manager.js";
export type { CacheStats, DirectoryEntry, FSAdapter, FSAdapterConfig, VeryfrontConfig, VeryfrontFSState, } from "./veryfront/types.js";
export type { ExtendedFileSystemAdapter } from "./wrapper.js";
export { FSAdapterWrapper, isExtendedFSAdapter, NotSupportedError, wrapFSAdapter, } from "./wrapper.js";
//# sourceMappingURL=index.d.ts.map