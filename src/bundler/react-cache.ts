/**
 * Shared React Module Cache
 *
 * Pre-caches React modules from esm.sh to local file:// paths and provides
 * a shared mapping for both JIT bundler and SSR execution.
 *
 * This eliminates React instance mismatches by ensuring both code paths
 * import React from identical file:// URLs.
 *
 * @module bundler/react-cache
 */

import { logger } from "#veryfront/utils";
import { cacheModuleToLocal } from "#veryfront/transforms/esm/http-cache.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { getReactCDNMapping } from "./build-config.ts";
import { getReactUrls } from "#veryfront/transforms/esm/package-registry.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";

export interface ReactModulePaths {
  react: string;
  "react-dom": string;
  "react-dom/client": string;
  "react-dom/server": string;
  "react/jsx-runtime": string;
  "react/jsx-dev-runtime": string;
}

/**
 * Cached React module paths by version.
 * Once initialized, these paths are reused for all bundling and SSR.
 */
const reactPathCache = new Map<string, ReactModulePaths>();
const initFlight = new Singleflight<ReactModulePaths>();

/**
 * Initialize and cache React modules for a given version.
 * Returns file:// paths that can be used directly in esbuild and SSR.
 *
 * This function is idempotent - calling it multiple times with the same
 * version returns the cached paths without re-downloading.
 */
export async function getReactModulePaths(
  reactVersion: string = REACT_DEFAULT_VERSION,
): Promise<ReactModulePaths> {
  // Return cached paths if available
  const cached = reactPathCache.get(reactVersion);
  if (cached) return cached;

  // Use singleflight to prevent concurrent initialization
  return initFlight.do(`react-${reactVersion}`, async () => {
    // Double-check cache after acquiring flight lock
    const existing = reactPathCache.get(reactVersion);
    if (existing) return existing;

    const cacheDir = getHttpBundleCacheDir();
    const cdnMapping = getReactCDNMapping(reactVersion);
    // Use getReactUrls for react-dom/server (not in getReactCDNMapping)
    const reactUrls = getReactUrls(reactVersion);

    logger.debug("[ReactCache] Caching React modules", {
      version: reactVersion,
      cacheDir,
    });

    // Cache all React modules in parallel (including react-dom/server for SSR)
    const [react, reactDom, reactDomClient, reactDomServer, jsxRuntime, jsxDevRuntime] =
      await Promise.all([
        cacheModuleToLocal(cdnMapping.react, cacheDir),
        cacheModuleToLocal(cdnMapping["react-dom"], cacheDir),
        cacheModuleToLocal(cdnMapping["react-dom/client"], cacheDir),
        cacheModuleToLocal(reactUrls["react-dom/server"], cacheDir),
        cacheModuleToLocal(cdnMapping["react/jsx-runtime"], cacheDir),
        cacheModuleToLocal(cdnMapping["react/jsx-dev-runtime"], cacheDir),
      ]);

    const paths: ReactModulePaths = {
      react,
      "react-dom": reactDom,
      "react-dom/client": reactDomClient,
      "react-dom/server": reactDomServer,
      "react/jsx-runtime": jsxRuntime,
      "react/jsx-dev-runtime": jsxDevRuntime,
    };

    // Verify all paths are file:// URLs
    const hasAllFilePaths = Object.values(paths).every((p) => p.startsWith("file://"));
    if (!hasAllFilePaths) {
      logger.warn("[ReactCache] Some React modules failed to cache locally", {
        paths,
      });
    } else {
      logger.debug("[ReactCache] All React modules cached successfully", {
        version: reactVersion,
        paths: Object.fromEntries(
          Object.entries(paths).map(([k, v]) => [k, v.slice(0, 60) + "..."]),
        ),
      });
    }

    reactPathCache.set(reactVersion, paths);
    return paths;
  });
}

/**
 * Check if React modules are already cached for a version.
 */
export function hasReactModulePaths(reactVersion: string = REACT_DEFAULT_VERSION): boolean {
  return reactPathCache.has(reactVersion);
}

/**
 * Clear the React module cache (for testing).
 */
export function clearReactModuleCache(): void {
  reactPathCache.clear();
}
