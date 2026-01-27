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
    constructor(options: SSRModuleLoaderOptions);
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
    private rewriteCrossProjectImport;
    /**
     * Rewrite local imports to use hashed temp paths.
     * This ensures each content version uses its own cached module file.
     */
    private rewriteLocalImports;
    /**
     * Build import patterns for a given specifier to match in transformed code.
     */
    private buildImportPatterns;
    private buildAliasImportPatterns;
    private buildAbsoluteImportPatterns;
    private buildRelativeImportPatterns;
    /**
     * Compute relative path from source directory to target file.
     */
    private computeRelativePath;
    /**
     * Convert TypeScript/JSX extension to .js
     */
    private toJsExtension;
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