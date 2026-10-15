import type { RenderResult } from "../orchestrator/types.ts";

/** Reserved control key within a render-cache context. */
export const CACHE_ALIAS_PROJECT_EPOCH_KEY = "render-alias-project-epoch:v1";
export const CACHE_ALIAS_EPOCH_KEY = "render-alias-epoch:v1";
export const CACHE_ALIAS_KEY_PREFIX = "render-aliases:v1:";

export interface CachePayload {
  /** Persistent context generation for explicit, unscoped cache aliases. */
  aliasEpoch?: string;
  /** Persistent project generation for shared invalidation across contexts. */
  aliasProjectEpoch?: string;
  result: RenderResult;
  /** Opaque cache-owned slot used to bind inline CSP nonces per response. */
  htmlNoncePlaceholder?: string;
  storedAt: number;
  expiresAt?: number;
  staleUntil?: number;
  /** Optional serialized form of result.nodeMap for JSON-based stores */
  nodeMapEntries?: Array<[number, unknown]>;
}

export interface CacheStoreStats {
  size: number;
}

export interface CacheStore {
  get(key: string): Promise<CachePayload | undefined>;
  set(key: string, value: CachePayload): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Delete `key` only when it still contains the value returned by `get`.
   *
   * Stores must implement this as an atomic compare-and-delete operation. A
   * read followed by an unconditional delete is not sufficient because it can
   * remove a replacement written by a concurrent render.
   */
  deleteIfUnchanged?(key: string, expected: CachePayload): Promise<boolean>;
  /** Delete all entries with keys starting with the given prefix */
  deleteByPrefix?(prefix: string): Promise<number>;
  clear(): Promise<void>;
  destroy(): Promise<void>;
  /** Optional stats contract for stores that can report entry counts */
  getStats?(): CacheStoreStats;
  /** Optional size accessor for cache stats */
  size?(): number;
}
