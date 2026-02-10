/**
 * Framework path validation and cached module integrity checks.
 *
 * Validates that cached module code has compatible file:// paths
 * for the current execution environment.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/framework-validator
 */

import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { FRAMEWORK_ROOT, LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { getLocalFs } from "../cache/index.ts";
import { extractHttpBundlePaths } from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";
import { ensureHttpBundlesExist } from "../../../esm/http-cache.ts";

/**
 * Check if cached code has file:// paths that are incompatible with this environment.
 * Returns true if the cached code should be invalidated (has paths from a different environment).
 *
 * Checks for:
 * 1. Framework source paths (file:///app/src/...) that don't match FRAMEWORK_ROOT
 * 2. HTTP bundle cache paths (file:///app/.cache/veryfront-http-bundle/...) that don't match local cache dir
 * 3. MDX ESM cache paths (file:///app/.cache/veryfront-mdx-esm/...) that don't match local cache dir
 *
 * IMPORTANT: This function creates a new RegExp on each call to avoid race conditions
 * when multiple modules are processed concurrently. Using a shared global regex with
 * the 'g' flag would cause interleaved exec() calls to skip paths.
 */
export async function hasIncompatibleFrameworkPaths(code: string, log: Logger): Promise<boolean> {
  // Check for esm.sh URLs that reference /_vf_modules/ paths - these are invalid
  // and indicate a cached transform from before the fix was deployed
  if (/esm\.sh\/_?vf_modules\//.test(code)) {
    log.debug(`${LOG_PREFIX_MDX_LOADER} Cached code has invalid esm.sh/_vf_modules URL`);
    return true;
  }

  const localHttpCacheDir = getHttpBundleCacheDir();
  const localMdxCacheDir = getMdxEsmCacheDir();
  const localFs = getLocalFs();

  // Create a NEW regex for each call to avoid race conditions with concurrent calls.
  // Global regexes maintain lastIndex state that can interleave between concurrent calls.
  const allFilePathsPattern = /file:\/\/([^"'\s]+)/gi;

  const allPaths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = allFilePathsPattern.exec(code)) !== null) {
    if (match[1]) allPaths.push(match[1]);
  }

  for (const path of allPaths) {
    if (path.includes("veryfront-http-bundle")) {
      if (!path.startsWith(localHttpCacheDir)) {
        log.debug(`${LOG_PREFIX_MDX_LOADER} HTTP bundle path from different environment`, {
          path,
          expectedDir: localHttpCacheDir,
        });
        return true;
      }
      continue;
    }

    if (path.includes("veryfront-mdx-esm")) {
      if (!path.startsWith(localMdxCacheDir)) {
        log.debug(`${LOG_PREFIX_MDX_LOADER} MDX cache path from different environment`, {
          path,
          expectedDir: localMdxCacheDir,
        });
        return true;
      }
      continue;
    }

    if (!path.includes("/src/") || path.includes(".cache")) continue;

    if (!path.startsWith(FRAMEWORK_ROOT)) {
      log.debug(`${LOG_PREFIX_MDX_LOADER} Framework path from different environment`, {
        path,
        expectedRoot: FRAMEWORK_ROOT,
      });
      return true;
    }

    try {
      const stat = await localFs.stat(path);
      if (!stat?.isFile) {
        log.debug(`${LOG_PREFIX_MDX_LOADER} Framework path does not exist`, { path });
        return true;
      }
    } catch {
      log.debug(`${LOG_PREFIX_MDX_LOADER} Framework path not accessible`, { path });
      return true;
    }
  }

  return false;
}

/**
 * Check if cached code has file:// paths that don't exist locally.
 * Returns list of missing paths, or empty array if all exist.
 *
 * This catches cases where distributed cache returns code with file:// paths
 * to vfmod modules that were created on a different pod/run with different hashes.
 */
export async function findMissingFileDependenciesInCode(
  code: string,
  log: Logger,
): Promise<string[]> {
  const localFs = getLocalFs();
  const pattern = /file:\/\/([^"'\s]+\.mjs)/gi;
  const missing: string[] = [];
  const checked = new Set<string>();

  let match;
  while ((match = pattern.exec(code)) !== null) {
    const path = match[1] as string;
    // Skip query parameters in paths
    const cleanPath = path.replace(/\?.*$/, "");

    if (checked.has(cleanPath)) continue;
    checked.add(cleanPath);

    try {
      const stat = await localFs.stat(cleanPath);
      if (!stat?.isFile) {
        log.debug(`${LOG_PREFIX_MDX_LOADER} File dependency does not exist`, { path: cleanPath });
        missing.push(cleanPath);
      }
    } catch {
      log.debug(`${LOG_PREFIX_MDX_LOADER} File dependency not accessible`, { path: cleanPath });
      missing.push(cleanPath);
    }
  }

  return missing;
}

/**
 * Check if code contains raw HTTP URLs that would fail in compiled binary mode.
 * Compiled binaries cannot do dynamic HTTP imports.
 */
export function hasRawHttpImports(code: string): boolean {
  // Match HTTP URLs in import statements: from "https://..." or from 'https://...'
  const httpImportPattern = /from\s+["'](https?:\/\/[^"']+)["']/gi;
  return httpImportPattern.test(code);
}

export async function validateCachedModule(
  normalizedPath: string,
  cachedPath: string,
  cachedCode: string,
  log: Logger,
  pathCache: Map<string, string>,
  versionedKey: string,
): Promise<boolean> {
  // Reject caches with raw HTTP URLs - all modules should use file:// paths.
  // This ensures consistency between compiled and non-compiled modes.
  if (hasRawHttpImports(cachedCode)) {
    log.warn(
      `${LOG_PREFIX_MDX_LOADER} Cached module has raw HTTP imports, invalidating legacy cache`,
      {
        normalizedPath,
        cachedPath,
      },
    );
    pathCache.delete(versionedKey);
    try {
      await getLocalFs().remove(cachedPath);
    } catch {
      /* ignore removal errors */
    }
    return false;
  }

  const bundlePaths = extractHttpBundlePaths(cachedCode);
  if (bundlePaths.length > 0) {
    const cacheDir = getHttpBundleCacheDir();
    const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
    if (failed.length > 0) {
      log.warn(`${LOG_PREFIX_MDX_LOADER} Cached module has missing HTTP bundles`, {
        normalizedPath,
        cachedPath,
        failed,
      });
      pathCache.delete(versionedKey);
      return false;
    }
  }

  if (!(await hasIncompatibleFrameworkPaths(cachedCode, log))) return true;

  log.warn(`${LOG_PREFIX_MDX_LOADER} Cached module has incompatible framework paths`, {
    normalizedPath,
    cachedPath,
    frameworkRoot: FRAMEWORK_ROOT,
  });

  pathCache.delete(versionedKey);
  try {
    await getLocalFs().remove(cachedPath);
  } catch {
    /* ignore removal errors */
  }
  return false;
}
