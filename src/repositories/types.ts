import type { DirEntry, FileInfo } from "#veryfront/platform/adapters/base.ts";
export type { CacheRepositoryOptions, CacheStats, RepositoryContext } from "./schemas/index.ts";
import type { CacheStats, RepositoryContext } from "./schemas/index.ts";

export interface FileSystemRepository {
  readFile(path: string): Promise<string>;
  readFileBytes(path: string): Promise<Uint8Array>;
  /** Read a prefix without materializing more than `byteLimit` bytes. */
  readFileBytesBounded?(path: string, byteLimit: number): Promise<Uint8Array>;
  /** Read the complete file only when it fits within `byteLimit`. */
  readFileBytesWithinLimit?(path: string, byteLimit: number): Promise<Uint8Array>;
  /** Read one stable, root-bound file snapshot within `byteLimit`. */
  readFileSnapshotWithinLimit?(path: string, byteLimit: number): Promise<Uint8Array>;
  /** Fixed upstream whole-object ceiling enforced before materialization. */
  readonly maxWholeFileReadBytes?: number;
  /**
   * Write UTF-8 text.
   *
   * Runtime filesystem adapters do not expose a binary write operation. Use a
   * binary-capable platform API instead of coercing arbitrary bytes to text.
   */
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileInfo>;
  readDir(path: string): AsyncIterable<DirEntry>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  readonly context: RepositoryContext;
}

export interface CacheRepository<T = string> {
  /** Return the live value, or `null` when the key is absent or expired. */
  get(key: string): Promise<T | null>;
  /**
   * Store a value for the configured default lifetime.
   *
   * A finite non-positive override expires immediately. Non-finite values and
   * values above the shared cache TTL limit are rejected.
   */
  set(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Delete keys whose unscoped key starts with this literal prefix. */
  deleteByPrefix?(prefix: string): Promise<number>;
  getStats?(): CacheStats;
  has?(key: string): Promise<boolean>;
  /**
   * Delete every key in this repository context.
   *
   * Distributed implementations reject when their backend cannot guarantee
   * scoped pattern deletion.
   */
  clear?(): Promise<void>;
  /** Immutable project and content-source identity captured at construction. */
  readonly context: RepositoryContext;
}
