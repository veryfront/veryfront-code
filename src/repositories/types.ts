/**
 * Repository Layer Types
 *
 * Core interfaces for filesystem and cache repositories that provide
 * project-scoped operations with unified interfaces.
 *
 * @module repositories/types
 */

import type { DirEntry, FileInfo } from "#veryfront/platform/adapters/base.ts";

/**
 * Context for repository operations.
 * Used to automatically scope keys and paths to the current project/environment.
 */
export interface RepositoryContext {
  /** Project identifier (slug or ID) */
  projectId: string;
  /** Environment (production or preview) */
  environment: "production" | "preview";
  /** Version ID (commit hash or version number) */
  versionId: string;
}

/**
 * FileSystem Repository Interface
 *
 * Wraps SecureFs with RepositoryContext for project-scoped operations.
 * Maintains the same interface as SecureFs for drop-in replacement.
 */
export interface FileSystemRepository {
  /** Read file contents as string */
  readFile(path: string): Promise<string>;
  /** Read file contents as bytes */
  readFileBytes(path: string): Promise<Uint8Array>;
  /** Write file contents */
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  /** Check if file exists */
  exists(path: string): Promise<boolean>;
  /** Get file info (stat) */
  stat(path: string): Promise<FileInfo>;
  /** Read directory entries */
  readDir(path: string): AsyncIterable<DirEntry>;
  /** Create directory */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** Remove file or directory */
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** Repository context for cache key generation */
  readonly context: RepositoryContext;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Total get operations */
  gets: number;
  /** Cache hits */
  hits: number;
  /** Cache misses */
  misses: number;
  /** Set operations */
  sets: number;
  /** Delete operations */
  deletes: number;
  /** Hit rate (0-1) */
  hitRate: number;
}

/**
 * Cache Repository Interface
 *
 * Provides project-scoped caching with automatic key prefixing.
 * Supports both memory and multi-tier distributed backends.
 */
export interface CacheRepository<T = string> {
  /** Get a value from cache (key is automatically scoped to project) */
  get(key: string): Promise<T | null>;
  /** Set a value in cache (key is automatically scoped to project) */
  set(key: string, value: T, ttlSeconds?: number): Promise<void>;
  /** Delete a value from cache */
  delete(key: string): Promise<void>;
  /** Delete all values with given prefix (within project scope) */
  deleteByPrefix?(prefix: string): Promise<number>;
  /** Get cache statistics */
  getStats?(): CacheStats;
  /** Check if key exists */
  has?(key: string): Promise<boolean>;
  /** Clear all entries for this project scope */
  clear?(): Promise<void>;
  /** Repository context for key scoping */
  readonly context: RepositoryContext;
}

/**
 * Options for creating a cache repository
 */
export interface CacheRepositoryOptions {
  /** Cache name for logging/debugging */
  name?: string;
  /** Default TTL in seconds */
  defaultTtlSeconds?: number;
  /** Maximum entries for memory cache */
  maxEntries?: number;
}

/**
 * Options for creating a filesystem repository
 */
export interface FileSystemRepositoryOptions {
  /** Base directory for file operations */
  baseDir: string;
  /** Security context for validation */
  securityContext?:
    | "user-input"
    | "static-serving"
    | "build"
    | "internal"
    | "route-discovery"
    | "module-loading";
}
