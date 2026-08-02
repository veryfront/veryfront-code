import type { DirEntry, FileInfo } from "#veryfront/platform/adapters/base.ts";
export type { CacheRepositoryOptions, CacheStats, RepositoryContext } from "./schemas/index.ts";
import type { CacheStats, RepositoryContext } from "./schemas/index.ts";

export interface FileSystemRepository {
  readFile(path: string): Promise<string>;
  readFileBytes(path: string): Promise<Uint8Array>;
  readFileBytesBounded?(path: string, byteLimit: number): Promise<Uint8Array>;
  readFileBytesWithinLimit?(path: string, byteLimit: number): Promise<Uint8Array>;
  readFileSnapshotWithinLimit?(path: string, byteLimit: number): Promise<Uint8Array>;
  readonly maxWholeFileReadBytes?: number;
  /** Write UTF-8 text. Binary writes require an explicitly binary repository API. */
  writeFile(path: string, content: string): Promise<void>;
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
