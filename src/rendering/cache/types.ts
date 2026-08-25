import type { RenderResult } from "../orchestrator/types.ts";

export interface CachePayload {
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
