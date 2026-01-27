/**
 * ESM Module Cache Operations
 *
 * Manages persistent module path caching for ESM module loading.
 *
 * @module build/transforms/mdx/esm-module-loader/cache
 */
import { join } from "../../../../../deps/deno.land/std@0.220.0/path/mod.js";
import { rendererLogger as logger } from "../../../../utils/index.js";
import { getMdxEsmCacheDir } from "../../../../utils/cache-dir.js";
import { createFileSystem, isNotFoundError, } from "../../../../platform/compat/fs.js";
import { TRANSFORM_CACHE_VERSION } from "../../../esm/package-registry.js";
import { LOG_PREFIX_MDX_LOADER } from "../constants.js";
// Local filesystem for cache operations (not project's FSAdapter which may be remote/read-only)
// This uses the platform's native fs (Deno, Node, Bun) for local cache writes
let localFs = null;
/**
 * Get or create the local filesystem instance.
 */
export function getLocalFs() {
    localFs ??= createFileSystem();
    return localFs;
}
// Persistent module path cache - survives across requests
// Maps normalized module paths to their disk cache file paths (per cacheDir)
const modulePathCaches = new Map();
const modulePathCacheLoaded = new Set();
/**
 * Get or load the module path cache.
 * The cache maps normalized module paths to their disk cache file paths.
 */
export async function getModulePathCache(cacheDir) {
    const existing = modulePathCaches.get(cacheDir);
    if (existing && modulePathCacheLoaded.has(cacheDir))
        return existing;
    const cache = existing ?? new Map();
    modulePathCaches.set(cacheDir, cache);
    const indexPath = join(cacheDir, "_index.json");
    try {
        const content = await getLocalFs().readTextFile(indexPath);
        const index = JSON.parse(content);
        for (const [path, cachePath] of Object.entries(index)) {
            cache.set(path, cachePath);
        }
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Loaded module index: ${cache.size} entries`);
    }
    catch {
        // Index doesn't exist yet
    }
    modulePathCacheLoaded.add(cacheDir);
    return cache;
}
/**
 * Save the module path cache to disk.
 */
export async function saveModulePathCache(cacheDir) {
    const cache = modulePathCaches.get(cacheDir);
    if (!cache)
        return;
    const indexPath = join(cacheDir, "_index.json");
    const index = {};
    for (const [path, cachePath] of cache.entries()) {
        index[path] = cachePath;
    }
    try {
        await getLocalFs().writeTextFile(indexPath, JSON.stringify(index));
    }
    catch (error) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to save module index`, error);
    }
}
/**
 * Clear the in-memory module path cache.
 * Called on invalidation to force re-checking disk cache.
 */
export function clearModulePathCache() {
    modulePathCaches.clear();
    modulePathCacheLoaded.clear();
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Cleared module path cache`);
}
/**
 * Invalidate specific module paths from the cache.
 * Called on selective invalidation when specific files are edited.
 * This is much faster than clearing the entire cache.
 */
export function invalidateModulePaths(changedPaths) {
    if (modulePathCaches.size === 0)
        return;
    let invalidatedCount = 0;
    for (const changedPath of changedPaths) {
        const normalizedChanged = changedPath
            .replace(/^\/+/, "")
            .replace(/\.(tsx?|jsx?|mdx)$/, "");
        for (const cache of modulePathCaches.values()) {
            for (const cachedPath of cache.keys()) {
                const normalizedCached = cachedPath
                    .replace(/^_vf_modules\//, "")
                    .replace(/\.js$/, "");
                if (normalizedCached === normalizedChanged ||
                    normalizedCached.endsWith(`/${normalizedChanged}`) ||
                    normalizedChanged.endsWith(`/${normalizedCached}`)) {
                    cache.delete(cachedPath);
                    invalidatedCount++;
                    logger.debug(`${LOG_PREFIX_MDX_LOADER} Invalidated module: ${cachedPath}`);
                }
            }
        }
    }
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Selective invalidation: ${invalidatedCount} modules for ${changedPaths.length} files`);
}
/**
 * Clear the persistent ESM disk cache.
 * Called when files are updated via Studio to ensure fresh content is served.
 */
export async function clearESMDiskCache() {
    const cacheDir = getMdxEsmCacheDir();
    const fs = getLocalFs();
    try {
        for await (const entry of fs.readDir(cacheDir)) {
            if (!entry.isFile || !entry.name.endsWith(".mjs"))
                continue;
            await fs.remove(join(cacheDir, entry.name));
        }
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Cleared ESM disk cache`);
    }
    catch (error) {
        if (!isNotFoundError(error)) {
            logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to clear ESM disk cache`, error);
        }
    }
}
/**
 * Convert a project-relative file path to MDX-ESM cache key format.
 *
 * @param filePath - Project-relative path like "lib/ChatContext.tsx" or absolute path
 * @param projectDir - Project directory to strip from absolute paths
 * @returns Cache key like "v10:_vf_modules/lib/ChatContext.js"
 */
function toMdxEsmCacheKey(filePath, projectDir) {
    // Strip project directory prefix if present
    let relativePath = filePath;
    if (projectDir && filePath.startsWith(projectDir)) {
        relativePath = filePath.slice(projectDir.length).replace(/^\/+/, "");
    }
    // Strip leading slashes
    relativePath = relativePath.replace(/^\/+/, "");
    // Convert extension to .js
    const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");
    // Build the versioned key in MDX-ESM format
    return `v${TRANSFORM_CACHE_VERSION}:_vf_modules/${jsPath}`;
}
/**
 * Look up a module in the MDX-ESM cache.
 *
 * This allows other loaders (like SSR loader) to reuse modules that
 * MDX-ESM has already transformed and cached, preventing duplicate
 * module instances (which breaks React context, etc.).
 *
 * @param filePath - Project-relative file path like "lib/ChatContext.tsx"
 * @param cacheDir - The MDX-ESM cache directory for this project/contentSource
 * @param projectDir - Project directory to strip from absolute paths
 * @param contentHash - Optional content hash to validate cached file freshness
 * @returns The cached file path if found and valid, null otherwise
 */
export async function lookupMdxEsmCache(filePath, cacheDir, projectDir, contentHash) {
    const cache = await getModulePathCache(cacheDir);
    const cacheKey = toMdxEsmCacheKey(filePath, projectDir);
    const cachedPath = cache.get(cacheKey);
    if (!cachedPath) {
        return null;
    }
    // Verify the cached file still exists
    try {
        const stat = await getLocalFs().stat(cachedPath);
        if (!stat?.isFile) {
            cache.delete(cacheKey);
            return null;
        }
        // If contentHash provided, validate the cached file contains matching hash
        // The cached filename includes the content hash (e.g., module.abc123.js)
        if (contentHash) {
            const filename = cachedPath.split("/").pop() ?? "";
            if (!filename.includes(contentHash.slice(0, 8))) {
                logger.debug(`${LOG_PREFIX_MDX_LOADER} Cache hash mismatch, invalidating: ${filePath}`);
                cache.delete(cacheKey);
                return null;
            }
        }
        logger.debug(`${LOG_PREFIX_MDX_LOADER} SSR reusing MDX-ESM cache: ${filePath} -> ${cachedPath}`);
        return cachedPath;
    }
    catch {
        // File no longer exists, remove stale entry
        cache.delete(cacheKey);
    }
    return null;
}
