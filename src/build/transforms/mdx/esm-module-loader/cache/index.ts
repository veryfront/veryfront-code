/**
 * ESM Module Cache Operations
 *
 * Manages persistent module path caching for ESM module loading.
 *
 * @module build/transforms/mdx/esm-module-loader/cache
 */

import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { getMdxEsmCacheDir } from "@veryfront/utils/cache-dir.ts";
import { createFileSystem, type FileSystem } from "@veryfront/platform/compat/fs.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";

// Local filesystem for cache operations (not project's FSAdapter which may be remote/read-only)
// This uses the platform's native fs (Deno, Node, Bun) for local cache writes
let _localFs: FileSystem | null = null;

/**
 * Get or create the local filesystem instance.
 */
export function getLocalFs(): FileSystem {
  if (!_localFs) {
    _localFs = createFileSystem();
  }
  return _localFs;
}

// Persistent module path cache - survives across requests
// Maps normalized module paths to their disk cache file paths (per cacheDir)
const modulePathCaches = new Map<string, Map<string, string>>();
const modulePathCacheLoaded = new Set<string>();

function getCacheKey(cacheDir: string): string {
  return cacheDir;
}

/**
 * Get or load the module path cache.
 * The cache maps normalized module paths to their disk cache file paths.
 */
export async function getModulePathCache(cacheDir: string): Promise<Map<string, string>> {
  const cacheKey = getCacheKey(cacheDir);
  const existing = modulePathCaches.get(cacheKey);
  if (existing && modulePathCacheLoaded.has(cacheKey)) {
    return existing;
  }

  const cache = existing ?? new Map<string, string>();
  modulePathCaches.set(cacheKey, cache);

  const indexPath = join(cacheDir, "_index.json");

  try {
    const content = await getLocalFs().readTextFile(indexPath);
    const index = JSON.parse(content) as Record<string, string>;
    for (const [path, cachePath] of Object.entries(index)) {
      cache.set(path, cachePath);
    }
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Loaded module index: ${cache.size} entries`);
  } catch {
    // Index doesn't exist yet
  }

  modulePathCacheLoaded.add(cacheKey);
  return cache;
}

/**
 * Save the module path cache to disk.
 */
export async function saveModulePathCache(cacheDir: string): Promise<void> {
  const cacheKey = getCacheKey(cacheDir);
  const cache = modulePathCaches.get(cacheKey);
  if (!cache) return;

  const indexPath = join(cacheDir, "_index.json");
  const index: Record<string, string> = {};
  for (const [path, cachePath] of cache.entries()) {
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
  modulePathCaches.clear();
  modulePathCacheLoaded.clear();
  logger.info(`${LOG_PREFIX_MDX_LOADER} Cleared module path cache`);
}

/**
 * Invalidate specific module paths from the cache.
 * Called on selective invalidation when specific files are edited.
 * This is much faster than clearing the entire cache.
 */
export function invalidateModulePaths(changedPaths: string[]): void {
  if (modulePathCaches.size === 0) return;

  let invalidatedCount = 0;

  for (const changedPath of changedPaths) {
    // Normalize the path for matching
    const normalizedChanged = changedPath.replace(/^\/+/, "").replace(/\.(tsx?|jsx?|mdx)$/, "");

    for (const cache of modulePathCaches.values()) {
      // Find and remove all cache entries that match or depend on this file
      for (const [cachedPath] of cache.entries()) {
        const normalizedCached = cachedPath
          .replace(/^_vf_modules\//, "")
          .replace(/\.js$/, "");

        // Check if the cached module matches the changed file
        if (
          normalizedCached === normalizedChanged ||
          normalizedCached.endsWith(`/${normalizedChanged}`) ||
          normalizedChanged.endsWith(`/${normalizedCached}`)
        ) {
          cache.delete(cachedPath);
          invalidatedCount++;
          logger.debug(`${LOG_PREFIX_MDX_LOADER} Invalidated module: ${cachedPath}`);
        }
      }
    }
  }

  logger.info(
    `${LOG_PREFIX_MDX_LOADER} Selective invalidation: ${invalidatedCount} modules for ${changedPaths.length} files`,
  );
}

/**
 * Clear the persistent ESM disk cache.
 * Called when files are updated via Studio to ensure fresh content is served.
 */
export async function clearESMDiskCache(): Promise<void> {
  const cacheDir = getMdxEsmCacheDir();
  try {
    // Remove all cached module files
    for await (const entry of Deno.readDir(cacheDir)) {
      if (entry.isFile && entry.name.endsWith(".mjs")) {
        await Deno.remove(join(cacheDir, entry.name));
      }
    }
    logger.info(`${LOG_PREFIX_MDX_LOADER} Cleared ESM disk cache`);
  } catch (error) {
    // Cache dir might not exist yet
    if (!(error instanceof Deno.errors.NotFound)) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to clear ESM disk cache`, error);
    }
  }
}
