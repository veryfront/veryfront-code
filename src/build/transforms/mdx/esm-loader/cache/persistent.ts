/**
 * Persistent Module Path Cache
 *
 * Manages the persistent module path cache that survives across requests.
 *
 * @module build/transforms/mdx/esm-loader/cache/persistent
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { getLocalFs } from "../local-fs.ts";

/** Persistent module path cache - survives across requests */
let _modulePathCache: Map<string, string> | null = null;
let _modulePathCacheLoaded = false;

/**
 * Get or create the persistent module path cache.
 * Maps normalized module paths to their disk cache file paths.
 */
export async function getModulePathCache(cacheDir: string): Promise<Map<string, string>> {
  if (_modulePathCache && _modulePathCacheLoaded) {
    return _modulePathCache;
  }

  _modulePathCache = new Map();
  const indexPath = join(cacheDir, "_index.json");

  try {
    const content = await getLocalFs().readTextFile(indexPath);
    const index = JSON.parse(content) as Record<string, string>;
    for (const [path, cachePath] of Object.entries(index)) {
      _modulePathCache.set(path, cachePath);
    }
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Loaded module index: ${_modulePathCache.size} entries`);
  } catch {
    // Index doesn't exist yet
  }

  _modulePathCacheLoaded = true;
  return _modulePathCache;
}

/**
 * Save the module path cache to disk.
 */
export async function saveModulePathCache(cacheDir: string): Promise<void> {
  if (!_modulePathCache) return;

  const indexPath = join(cacheDir, "_index.json");
  const index: Record<string, string> = {};
  for (const [path, cachePath] of _modulePathCache.entries()) {
    index[path] = cachePath;
  }

  try {
    await getLocalFs().writeTextFile(indexPath, JSON.stringify(index));
  } catch (error) {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to save module index`, error);
  }
}

/**
 * Clear the in-memory module path cache.
 * Called on invalidation to force re-checking disk cache.
 */
export function clearModulePathCache(): void {
  _modulePathCache = null;
  _modulePathCacheLoaded = false;
  logger.info(`${LOG_PREFIX_MDX_LOADER} Cleared module path cache`);
}

/**
 * Invalidate specific module paths from the cache.
 * Called on selective invalidation when specific files are edited.
 * This is much faster than clearing the entire cache.
 */
export function invalidateModulePaths(changedPaths: string[]): void {
  if (!_modulePathCache) return;

  let invalidatedCount = 0;

  for (const changedPath of changedPaths) {
    // Normalize the path for matching
    const normalizedChanged = changedPath.replace(/^\/+/, "").replace(/\.(tsx?|jsx?|mdx)$/, "");

    // Find and remove all cache entries that match or depend on this file
    for (const [cachedPath, _cachePath] of _modulePathCache.entries()) {
      const normalizedCached = cachedPath
        .replace(/^_vf_modules\//, "")
        .replace(/\.js$/, "");

      // Check if the cached module matches the changed file
      if (
        normalizedCached === normalizedChanged ||
        normalizedCached.endsWith(`/${normalizedChanged}`) ||
        normalizedChanged.endsWith(`/${normalizedCached}`)
      ) {
        _modulePathCache.delete(cachedPath);
        invalidatedCount++;
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Invalidated module: ${cachedPath}`);
      }
    }
  }

  logger.info(
    `${LOG_PREFIX_MDX_LOADER} Selective invalidation: ${invalidatedCount} modules for ${changedPaths.length} files`,
  );
}
