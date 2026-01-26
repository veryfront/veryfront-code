/**
 * Import Map Preloader
 *
 * Caches import maps to avoid repeated loading during layout application.
 * When multiple MDX layouts need the import map, this ensures it's only
 * loaded once per project directory.
 */

import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { ImportMapConfig } from "./types.js";
import { loadImportMap } from "./loader.js";

/**
 * Cache of import map loading promises, keyed by project directory.
 * Using promises to dedupe concurrent loads.
 */
const importMapCache = new Map<string, Promise<ImportMapConfig>>();

/**
 * Preload and cache import map for a project directory.
 *
 * This ensures the import map is only loaded once per project,
 * even when multiple MDX layouts request it concurrently.
 *
 * @param projectDir The project directory path
 * @param adapter Runtime adapter for file system access
 * @returns The loaded import map configuration
 */
export function preloadImportMap(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<ImportMapConfig> {
  const cached = importMapCache.get(projectDir);
  if (cached) {
    return cached;
  }

  const promise = loadImportMap(projectDir, adapter);
  importMapCache.set(projectDir, promise);

  // Clean up on failure to allow retry
  promise.catch(() => {
    importMapCache.delete(projectDir);
  });

  return promise;
}

/**
 * Get import map from cache if available, or return undefined.
 *
 * @param projectDir The project directory path
 * @returns The cached import map or undefined if not cached
 */
export async function getCachedImportMap(
  projectDir: string,
): Promise<ImportMapConfig | undefined> {
  const cached = importMapCache.get(projectDir);
  if (!cached) {
    return undefined;
  }

  try {
    return await cached;
  } catch {
    return undefined;
  }
}

/**
 * Clear import map cache for a specific project or all projects.
 *
 * @param projectDir Optional project directory to clear. If not provided, clears all.
 */
export function clearImportMapCache(projectDir?: string): void {
  if (projectDir) {
    importMapCache.delete(projectDir);
  } else {
    importMapCache.clear();
  }
}
