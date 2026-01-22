/**
 * ESM Module Loader Types
 *
 * Type definitions for the MDX ESM module loading system.
 *
 * @module build/transforms/mdx/esm-module-loader/types
 */

import type { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { MDXModule } from "../types.ts";

/**
 * Context for ESM module loading operations.
 */
export interface ESMLoaderContext {
  /** Directory for caching ESM modules */
  esmCacheDir?: string;
  /** LRU cache for loaded modules */
  moduleCache: LRUCache<string, MDXModule>;
  /** Optional adapter for file operations. If not provided, uses getAdapter() */
  adapter?: RuntimeAdapter;
  /** Project identifier for cache isolation */
  projectId?: string;
  /** Project directory for file resolution (required for deterministic import map resolution) */
  projectDir?: string;
  /** Project slug for HTTP fallback URLs (multi-project mode) */
  projectSlug?: string;
  /** Content source identifier for cache isolation (branch name or release ID) */
  contentSourceId?: string;
}

/**
 * Filesystem adapter interface for cache operations.
 * Uses local filesystem (not project's FSAdapter which may be remote/read-only).
 */
export interface FSAdapter {
  readFile(path: string): Promise<string | Uint8Array>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  stat(path: string): Promise<{ isFile?: boolean } | null>;
  makeTempDir(prefix: string): Promise<string>;
}

/**
 * Import match found during code transformation.
 */
export interface ImportMatch {
  /** The full matched import statement */
  original: string;
  /** The module path being imported */
  path: string;
}

/**
 * Result of a module fetch operation.
 */
export interface ModuleFetchResult {
  /** The original import statement */
  original: string;
  /** The file path of the cached module, or null if fetch failed */
  filePath: string | null;
  /** The module path that was requested */
  path: string;
}

/**
 * Result of nested import processing.
 */
export interface NestedImportResult {
  /** The original import statement */
  original: string;
  /** The file path of the cached module, or null if fetch failed */
  nestedFilePath: string | null;
  /** The module path that was requested */
  nestedPath?: string;
  /** The relative path (for relative imports) */
  relativePath?: string;
}

/**
 * Context for the module fetcher operations.
 */
export interface ModuleFetcherContext {
  /** Directory for caching ESM modules */
  esmCacheDir: string;
  /** Runtime adapter for file operations */
  adapter: RuntimeAdapter;
  /** Project directory */
  projectDir: string;
  /** Project identifier */
  projectId: string;
  /** Project slug for HTTP fallback URLs (multi-project mode) */
  projectSlug?: string;
  /** Whether running in local development mode (affects HTTP fallback behavior) */
  isLocalDev?: boolean;
}

/**
 * JSX transformation result.
 */
export interface JSXTransform {
  /** The original import statement */
  original: string;
  /** The transformed import statement */
  transformed: string;
}
