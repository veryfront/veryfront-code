/**
 * Cache Backend Type Definitions
 *
 * This file contains the core types for the cache system.
 * Separated from implementation to avoid circular dependencies.
 *
 * @module cache/types
 */

// Re-export schema types
export type { CacheBackendType, CacheSetBatchEntry } from "./schemas/index.ts";

// Import for use in interface
import type { CacheBackendType, CacheSetBatchEntry } from "./schemas/index.ts";
import type { ResolvedCacheAuthority } from "./request-authority.ts";

/** Maximum number of code units in a cache revision identifier. */
export const MAX_CACHE_REVISION_LENGTH = 256;

/** Serialized logical value and the revision that observed it. */
export interface CacheRevisionSnapshot {
  readonly value: string | null;
  readonly revision: string;
}

/** Atomic mutation applied when an expected cache revision still matches. */
export type CacheRevisionMutation =
  | {
    readonly kind: "set";
    readonly value: string;
    readonly expiresAtMs: number;
  }
  | { readonly kind: "delete" };

/** Options for a single logical backend read. */
export interface CacheReadOptions {
  /**
   * Invoked with the authority the backend resolved at the moment it performed
   * an underlying network read serving this call: the credential and project
   * the value was actually fetched under, as opposed to whatever the caller
   * resolved before awaiting. A failed batch request falls back to individual
   * reads that resolve authority again, so one logical read can report more
   * than once; a caller holding a returned value in front of the backend's
   * authority gate must treat every reported authority as one the value may
   * have been fetched under. Backends that do not gate reads on a per-request
   * authority never invoke it.
   */
  onAuthority?: (authority: ResolvedCacheAuthority) => void;
}

/**
 * Provides storage operations for memory, disk, API, and extension-backed distributed caches.
 * All cache backends must implement this interface.
 */
export interface CacheBackend {
  /** Backend type identifier */
  readonly type: CacheBackendType;

  /**
   * The credential and project reference this backend's reads are made under.
   *
   * Implemented only by backends that gate on a per-request authority. Anything
   * caching a result in front of that gate must scope what it holds on this
   * rather than re-deriving it, because a backend holding an explicit endpoint
   * credential does not read under the ambient one. Never returns the token to
   * a log; see `cache/request-authority.ts`.
   */
  cacheAuthority?(): ResolvedCacheAuthority;

  /**
   * Get a value from the cache.
   * @param key - Cache key
   * @param options - Read options; see {@link CacheReadOptions}
   * @returns The cached value or null if not found
   */
  get(key: string, options?: CacheReadOptions): Promise<string | null>;

  /**
   * Read one value while enforcing an exact UTF-8 payload-byte ceiling before
   * an untrusted backend can materialize an oversized value. Overflow rejects
   * with CacheValueTooLargeError; it is never reported as a cache miss.
   */
  getWithinLimit?(key: string, maximumBytes: number): Promise<string | null>;

  /**
   * Atomically observe a raw serialized value and its provider-owned revision.
   * An absent value is null and still has a revision. This method is usable
   * only when compareExchange is also callable.
   */
  getWithRevision?(key: string): Promise<CacheRevisionSnapshot>;

  /**
   * Get the remaining lifetime in seconds. Returns null when the entry is
   * absent, expired, or the backend cannot determine its expiry.
   */
  getRemainingTtlSeconds?(key: string): Promise<number | null>;

  /**
   * Get multiple values from the cache in a single batch.
   * A batch may contain at most the shared `MAX_BATCH_SIZE` items.
   * @param keys - Array of cache keys
   * @param options - Read options; see {@link CacheReadOptions}
   * @returns Map of key to value (null for missing keys)
   */
  getBatch?(keys: string[], options?: CacheReadOptions): Promise<Map<string, string | null>>;

  /**
   * Set a value in the cache.
   * @param key - Cache key
   * @param value - Value to store
   * @param ttlSeconds - Finite time to live in seconds. A non-positive value
   * expires immediately: implementations remove any existing entry and store
   * nothing.
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /**
   * Apply a raw mutation when the expected revision matches. expiresAtMs is
   * the caller's original positive safe-integer Unix epoch millisecond
   * deadline, not a relative TTL. This method is usable only when
   * getWithRevision is also callable. A true result advances to a never-reused
   * revision, including for a same-byte set or absent delete. An accepted set
   * whose deadline has already passed leaves the logical value absent and
   * still advances the revision. A false result means the revision did not
   * match and leaves the logical value unchanged. Backend errors reject.
   */
  compareExchange?(
    key: string,
    expectedRevision: string,
    mutation: CacheRevisionMutation,
  ): Promise<boolean>;

  /**
   * Set multiple values in the cache in a single batch.
   * A batch may contain at most the shared `MAX_BATCH_SIZE` items.
   * @param entries - Array of {key, value, ttl} objects
   */
  setBatch?(entries: CacheSetBatchEntry[]): Promise<void>;

  /**
   * Delete a value from the cache.
   * @param key - Cache key
   */
  del(key: string): Promise<void>;

  /**
   * Delete all values matching a pattern.
   * @param pattern - Glob pattern (e.g., "user:*")
   * @returns Number of deleted keys
   */
  delByPattern?(pattern: string): Promise<number>;

  /** Current number of entries (for memory backend) */
  readonly size?: number;
}

/** Cache backend with the complete atomic revision capability. */
export interface RevisionedCacheBackend extends CacheBackend {
  getWithRevision(key: string): Promise<CacheRevisionSnapshot>;
  compareExchange(
    key: string,
    expectedRevision: string,
    mutation: CacheRevisionMutation,
  ): Promise<boolean>;
}
