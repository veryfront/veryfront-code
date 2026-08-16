/**
 * SSR Module Loader Types
 *
 * Type definitions for the SSR module loading system.
 *
 * @module module-system/react-loader/ssr-module-loader/types
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";

export interface SSRModuleLoaderOptions {
  projectDir: string;
  projectId: string;
  /** Project slug for cache directory (human-readable name) */
  projectSlug?: string;
  adapter: RuntimeAdapter;
  dev: boolean;
  apiBaseUrl?: string;
  /** Absolute request origin used to identify same-origin module URLs. */
  moduleServerOrigin?: string;
  /** Content source ID for cache isolation (branch name or release ID) */
  contentSourceId?: string;
  /** React version for transforms (defaults to DEFAULT_REACT_VERSION) */
  reactVersion?: string;
  /** Bare npm package roots that the runtime resolves without bundling. */
  serverExternalPackages?: readonly string[];
  /** Stable VERYFRONT_DEPENDENCY_PINNING + package dependency-map state. */
  dependencyPinningCacheKey?: string;
  /** Immutable package map paired with dependencyPinningCacheKey. */
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /** Exact package source namespace used to prove write-back authority. */
  dependencyPinningSource?: DependencyPinningSourceInput;
  /** Request mode ("preview" | "production") for studio features */
  mode?: string;
}

export interface ModuleCacheEntry {
  tempPath: string;
  contentHash: string;
}

export interface FailureRecord {
  count: number;
  lastFailure: number;
}

export interface SSRModuleCacheStats {
  memoryEntries: number;
  maxEntries: number;
  tmpDirs: number;
  distributedCacheEnabled: boolean;
}
