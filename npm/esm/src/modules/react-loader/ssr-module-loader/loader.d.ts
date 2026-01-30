import type * as React from "react";
import type { SSRModuleLoaderOptions } from "./types.js";
/**
 * SSR Module Loader with Redis Support.
 *
 * Loads and transforms React components for server-side rendering.
 * Supports Redis caching to share transformed modules across pods.
 */
export declare class SSRModuleLoader {
    private options;
    private fs;
    private missingDependencies;
    private cachedConfigHash;
    constructor(options: SSRModuleLoaderOptions);
    /** Lazily compute config hash once per loader instance. */
    private getConfigHash;
    /**
     * Load and transform a module for SSR.
     */
    loadModule(filePath: string, source: string): Promise<React.ComponentType<Record<string, unknown>>>;
    private checkCircuitBreaker;
    private throwMissingDependencies;
    private getCacheKey;
    private isProductionContentSource;
    private getRegistryBaseUrl;
    /**
     * Fetch and transform a cross-project import.
     */
    private transformCrossProjectImport;
    private transformWithDependencies;
    private doTransformWithDependencies;
    /**
     * Process local imports and return a map of specifier -> hashed temp path
     * This allows the parent file to have its imports rewritten to the correct hashed paths.
     */
    private processLocalImports;
    private ensureDependenciesExist;
    /**
     * Async hash for large content using Web Crypto API.
     * Falls back to sync hash for small files.
     */
    private hashContentAsync;
    private getTempPath;
    private ensureTmpDir;
}
//# sourceMappingURL=loader.d.ts.map