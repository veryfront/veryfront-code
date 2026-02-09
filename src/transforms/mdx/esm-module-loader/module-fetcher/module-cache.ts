/****
 * Local filesystem module caching and path normalization.
 *
 * Handles writing transformed modules to the local cache directory
 * and normalizing module paths for consistent cache key generation.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/module-cache
 */

import { join } from "#veryfront/compat/path";
import * as posix from "#std/path/posix";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { getLocalFs, saveModulePathCache } from "../cache/index.ts";
import { hashString } from "../utils/hash.ts";
import { getVersionedPathCacheKey } from "./cache-keys.ts";
import { hasUnresolvedImports } from "./nested-imports.ts";
import { recordModuleToSession } from "./render-sessions.ts";

/**
 * Normalize a module path, resolving relative paths if a parent is provided.
 */
export function normalizePath(modulePath: string, parentModulePath?: string): string {
  // Strip query parameters (e.g., ?ssr=true) as they're not part of the file path
  // and cause issues with cache key validation (? is not an allowed character)
  let normalizedPath = modulePath.replace(/\?.*$/, "").replace(/^\//, "");

  if (!parentModulePath) return normalizedPath;
  if (!modulePath.startsWith("./") && !modulePath.startsWith("../")) return normalizedPath;

  const parentDir = parentModulePath.replace(/\/[^/]+$/, "");
  normalizedPath = posix.normalize(posix.join(parentDir, modulePath));

  if (!normalizedPath.startsWith("_vf_modules/")) normalizedPath = `_vf_modules/${normalizedPath}`;
  return normalizedPath;
}

/**
 * Write module to cache and return the cache path.
 *
 * Skips caching if the module has unresolved imports (indicates incomplete
 * dependency resolution). Otherwise writes to the local filesystem cache
 * and updates the path cache map.
 */
export async function cacheModule(
  normalizedPath: string,
  moduleCode: string,
  esmCacheDir: string,
  pathCache: Map<string, string>,
  log: Logger,
): Promise<string | null> {
  const unresolved = hasUnresolvedImports(moduleCode);
  if (unresolved.count > 0) {
    log.warn(
      `${LOG_PREFIX_MDX_LOADER} Module has ${unresolved.count} unresolved imports, skipping cache`,
      { path: normalizedPath, unresolved: unresolved.paths },
    );
    return null;
  }

  const contentHash = hashString(normalizedPath + moduleCode);
  const cachePath = join(esmCacheDir, `vfmod-v${VERSION}-${contentHash}.mjs`);

  const localFs = getLocalFs();
  try {
    const stat = await localFs.stat(cachePath);
    if (stat?.isFile) {
      pathCache.set(getVersionedPathCacheKey(normalizedPath), cachePath);
      log.debug(`${LOG_PREFIX_MDX_LOADER} Content cache hit: ${normalizedPath}`);
      recordModuleToSession(normalizedPath);
      return cachePath;
    }
  } catch {
    // Not cached, write it
  }

  await localFs.mkdir(esmCacheDir, { recursive: true });
  await localFs.writeTextFile(cachePath, moduleCode);
  pathCache.set(getVersionedPathCacheKey(normalizedPath), cachePath);
  await saveModulePathCache(esmCacheDir);
  log.debug(`${LOG_PREFIX_MDX_LOADER} Cached vf_module: ${normalizedPath} -> ${cachePath}`);

  recordModuleToSession(normalizedPath);
  return cachePath;
}
