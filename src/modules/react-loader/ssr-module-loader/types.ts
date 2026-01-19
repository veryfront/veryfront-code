/**
 * SSR Module Loader Types
 *
 * Type definitions for the SSR module loading system.
 *
 * @module module-system/react-loader/ssr-module-loader/types
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

/**
 * Options for creating an SSRModuleLoader instance.
 */
export interface SSRModuleLoaderOptions {
  projectDir: string;
  projectId: string;
  adapter: RuntimeAdapter;
  dev: boolean;
  apiBaseUrl?: string;
}

/**
 * Cache entry for transformed modules.
 */
export interface ModuleCacheEntry {
  tempPath: string;
  contentHash: string;
}

/**
 * Circuit breaker failure record.
 */
export interface FailureRecord {
  count: number;
  lastFailure: number;
}

/**
 * SSR module cache statistics.
 */
export interface SSRModuleCacheStats {
  memoryEntries: number;
  maxEntries: number;
  tmpDirs: number;
  redisEnabled: boolean;
}
