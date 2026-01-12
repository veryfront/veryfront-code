/**
 * ESM Module Loader Types
 *
 * Type definitions for the ESM module loading system.
 *
 * @module build/transforms/mdx/esm-loader/types
 */

import type { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { MDXModule } from "../types.ts";

/**
 * Filesystem adapter interface for module operations.
 */
export interface FSAdapter {
  readFile(path: string): Promise<string | Uint8Array>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  stat(path: string): Promise<{ isFile?: boolean } | null>;
  makeTempDir(prefix: string): Promise<string>;
}

/**
 * ESM loader context containing cache and configuration.
 */
export interface ESMLoaderContext {
  esmCacheDir?: string;
  moduleCache: LRUCache<string, MDXModule>;
  /** Optional adapter to use for file operations. If not provided, uses getAdapter() */
  adapter?: RuntimeAdapter;
}

/**
 * Module fetch context for recursive module loading.
 */
export interface ModuleFetchContext {
  /** Cache directory for ESM modules */
  esmCacheDir: string;
  /** Runtime adapter for file and env operations */
  adapter: RuntimeAdapter;
  /** Project directory */
  projectDir: string;
  /** Project ID */
  projectId: string;
  /** In-flight fetch tracking map */
  inFlight: Map<string, Promise<string | null>>;
}

/**
 * Result of processing imports in a module.
 */
export interface ProcessedImports {
  /** The module code with imports replaced */
  code: string;
  /** Whether any imports were unresolved */
  hasUnresolved: boolean;
}
