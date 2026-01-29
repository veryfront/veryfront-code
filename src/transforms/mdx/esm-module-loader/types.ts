import type { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import type { MDXModule } from "../types.ts";

export interface ESMLoaderContext {
  esmCacheDir?: string;
  moduleCache: LRUCache<string, MDXModule>;
  adapter?: RuntimeAdapter;
  projectId?: string;
  projectDir?: string;
  projectSlug?: string;
  contentSourceId?: string;
  /** React version for transforms (from project config) */
  reactVersion?: string;
  /**
   * If true, missing modules fail fast instead of being stubbed.
   * Defaults to true when not specified.
   */
  strictMissingModules?: boolean;
}

export interface FSAdapter {
  readFile(path: string): Promise<string | Uint8Array>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  stat(path: string): Promise<{ isFile?: boolean } | null>;
  makeTempDir(prefix: string): Promise<string>;
}

export interface ImportMatch {
  original: string;
  path: string;
}

export interface ModuleFetchResult {
  original: string;
  filePath: string | null;
  path: string;
}

export interface NestedImportResult {
  original: string;
  nestedFilePath: string | null;
  nestedPath?: string;
  relativePath?: string;
}

export interface ModuleFetcherContext {
  esmCacheDir: string;
  adapter: RuntimeAdapter;
  projectDir: string;
  projectId: string;
  projectSlug?: string;
  isLocalDev?: boolean;
  /**
   * Tracks modules currently being processed to detect circular imports.
   * Key: normalized module path, Value: promise resolving to cached path.
   * This prevents infinite recursion when A imports B which imports A.
   */
  inFlightModules?: Map<string, Promise<string | null>>;
  /** React version for transforms (from project config) */
  reactVersion?: string;
  /** Logger with request-scoped context (project_id, project_slug, requestId, etc.) */
  logger?: Logger;
  /**
   * If true, missing modules fail fast instead of being stubbed.
   * Defaults to true when not specified.
   */
  strictMissingModules?: boolean;
}

export interface JSXTransform {
  original: string;
  transformed: string;
}
