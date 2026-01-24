/**
 * ESM Module Cache Operations
 *
 * Manages persistent module path caching for ESM module loading.
 *
 * @module build/transforms/mdx/esm-module-loader/cache
 */

import { join } from "#std/path.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import {
  createFileSystem,
  type FileSystem,
  isNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";

// Local filesystem for cache operations (not project's FSAdapter which may be remote/read-only)
// This uses the platform's native fs (Deno, Node, Bun) for local cache writes
let localFs: FileSystem | null = null;

/**
 * Get or create the local filesystem instance.
 */
export function getLocalFs(): FileSystem {
  localFs ??= createFileSystem();
  return localFs;
}

// Persistent module path cache - survives across requests
// Maps normalized module paths to their disk cache file paths (per cacheDir)
const modulePathCaches = new Map<string, Map<string, string>>();
const modulePathCacheLoaded = new Set<string>();

/**
 * Get or load the module path cache.
 * The cache maps normalized module paths to their disk cache file paths.
 */
export async function getModulePathCache(cacheDir: string): Promise<Map<string, string>> {
  const existing = modulePathCaches.get(cacheDir);
  if (existing && modulePathCacheLoaded.has(cacheDir)) return existing;

  const cache = existing ?? new Map<string, string>();
  modulePathCaches.set(cacheDir, cache);

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

  modulePathCacheLoaded.add(cacheDir);
  return cache;
}

/**
 * Save the module path cache to disk.
 */
export async function saveModulePathCache(cacheDir: string): Promise<void> {
  const cache = modulePathCaches.get(cacheDir);
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
  logger.debug(`${LOG_PREFIX_MDX_LOADER} Cleared module path cache`);
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
    const normalizedChanged = changedPath
      .replace(/^\/+/, "")
      .replace(/\.(tsx?|jsx?|mdx)$/, "");

    for (const cache of modulePathCaches.values()) {
      for (const cachedPath of cache.keys()) {
        const normalizedCached = cachedPath
          .replace(/^_vf_modules\//, "")
          .replace(/\.js$/, "");

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

  logger.debug(
    `${LOG_PREFIX_MDX_LOADER} Selective invalidation: ${invalidatedCount} modules for ${changedPaths.length} files`,
  );
}

/**
 * Clear the persistent ESM disk cache.
 * Called when files are updated via Studio to ensure fresh content is served.
 */
export async function clearESMDiskCache(): Promise<void> {
  const cacheDir = getMdxEsmCacheDir();
  const fs = getLocalFs();

  try {
    for await (const entry of fs.readDir(cacheDir)) {
      if (!entry.isFile || !entry.name.endsWith(".mjs")) continue;
      await fs.remove(join(cacheDir, entry.name));
    }
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Cleared ESM disk cache`);
  } catch (error) {
    if (!isNotFoundError(error)) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to clear ESM disk cache`, error);
    }
  }
}
