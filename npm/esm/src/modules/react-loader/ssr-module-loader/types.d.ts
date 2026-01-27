/**
 * SSR Module Loader Types
 *
 * Type definitions for the SSR module loading system.
 *
 * @module module-system/react-loader/ssr-module-loader/types
 */
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
export interface SSRModuleLoaderOptions {
    projectDir: string;
    projectId: string;
    /** Project slug for cache directory (human-readable name) */
    projectSlug?: string;
    adapter: RuntimeAdapter;
    dev: boolean;
    apiBaseUrl?: string;
    /** Content source ID for cache isolation (branch name or release ID) */
    contentSourceId?: string;
    /** React version for transforms (defaults to DEFAULT_REACT_VERSION) */
    reactVersion?: string;
}
export interface ModuleCacheEntry {
    tempPath: string;
    contentHash: string;
}
export interface FailureRecord {
    count: number;
    lastFailure: number;
}
export interface SSRModuleCacheStats {
    memoryEntries: number;
    maxEntries: number;
    tmpDirs: number;
    redisEnabled: boolean;
}
//# sourceMappingURL=types.d.ts.map