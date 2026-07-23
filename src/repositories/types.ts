import type { DirEntry, FileInfo } from "#veryfront/platform/adapters/base.ts";
export type { CacheRepositoryOptions, CacheStats, RepositoryContext } from "./schemas/index.ts";
import type { CacheStats, RepositoryContext } from "./schemas/index.ts";

export interface FileSystemRepository {
  readFile(path: string): Promise<string>;
  readFileBytes(path: string): Promise<Uint8Array>;
  /** Write text, or bytes that round-trip exactly through UTF-8. */
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileInfo>;
  readDir(path: string): AsyncIterable<DirEntry>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  readonly context: RepositoryContext;
}

export interface CacheRepository<T = string> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix?(prefix: string): Promise<number>;
  getStats?(): CacheStats;
  has?(key: string): Promise<boolean>;
  clear?(): Promise<void>;
  readonly context: RepositoryContext;
}
