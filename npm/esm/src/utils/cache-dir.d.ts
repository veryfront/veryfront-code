export declare function runWithCacheDir<T>(cacheDir: string, fn: () => T): T;
export declare function getCacheDirFromContext(): string | undefined;
export declare function getCacheBaseDir(): string;
export declare function getMdxEsmCacheDir(): string;
export declare function getHttpBundleCacheDir(): string;
/**
 * Ensure cached ESM modules can resolve bare specifiers (e.g. `import 'react'`)
 * when running on Node.js.
 *
 * Cached .mjs files live under getCacheBaseDir() (e.g. /app/.cache/). Node.js
 * resolves bare specifiers by walking up from the importing file looking for
 * node_modules/. Because the cache directory has no node_modules ancestor,
 * packages like `react` cannot be found.
 *
 * This function creates a symlink:
 *   {cacheBaseDir}/node_modules → {framework's node_modules}
 *
 * so Node.js module resolution finds the same packages the framework itself uses,
 * guaranteeing a single React instance (no "Invalid hook call" errors).
 */
export declare function ensureCacheNodeModules(): Promise<void>;
//# sourceMappingURL=cache-dir.d.ts.map