/**
 * Cache directory utilities for disk-based caching.
 *
 * Uses AsyncLocalStorage for proper test isolation - each async context
 * (e.g., each test) can have its own isolated cache directory without
 * relying on global state that can be corrupted in parallel execution.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { cwd } from "@veryfront/platform/compat/process.ts";
import { getCacheDirEnv } from "@veryfront/core/config/env.ts";

// AsyncLocalStorage for cache directory isolation across async contexts
const cacheStorage = new AsyncLocalStorage<string>();

/**
 * Run a function with an isolated cache directory.
 * All calls to getCacheBaseDir() within this context will return the specified directory.
 */
export function runWithCacheDir<T>(cacheDir: string, fn: () => T): T {
  return cacheStorage.run(cacheDir, fn);
}

/**
 * Get the base cache directory path.
 *
 * Priority:
 * 1. AsyncLocalStorage context (for test isolation)
 * 2. VF_CACHE_DIR environment variable
 * 3. .cache in current working directory
 */
export function getCacheBaseDir(): string {
  // First check AsyncLocalStorage context (highest priority for isolation)
  const contextCacheDir = cacheStorage.getStore();
  if (contextCacheDir) {
    return contextCacheDir;
  }

  // Then check environment variable
  const envCacheDir = getCacheDirEnv();
  if (envCacheDir) {
    return envCacheDir;
  }

  // Default to .cache in cwd
  return join(cwd(), ".cache");
}

/**
 * Get the MDX ESM cache directory path.
 */
export function getMdxEsmCacheDir(): string {
  return join(getCacheBaseDir(), "veryfront-mdx-esm");
}

/**
 * Get the HTTP bundle cache directory path.
 */
export function getHttpBundleCacheDir(): string {
  return join(getCacheBaseDir(), "veryfront-http-bundle");
}
