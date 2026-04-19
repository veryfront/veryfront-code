/**
 * Contract interface for OAuth-token-style cache stores used by the proxy.
 *
 * This contract is richer than the generic `CacheStore` — it adds scan-by-prefix,
 * bulk read, and usage statistics primitives that the proxy's token cache needs.
 * Simpler key-value consumers should use `CacheStore` instead.
 *
 * Default implementation: `@veryfront/ext-redis`.
 *
 * @module extensions/interfaces/token-cache-store
 */

/**
 * A cache entry stored by `TokenCacheStore`.
 *
 * The proxy persists OAuth tokens keyed by request metadata; this entry shape
 * mirrors what the proxy has historically stored.
 */
export interface TokenCacheEntry {
  token: string;
  /** Unix timestamp in milliseconds. */
  expiresAt: number;
  scope: "preview" | "production";
  projectSlug?: string;
}

/**
 * Aggregate usage statistics for a `TokenCacheStore`.
 */
export interface TokenCacheStats {
  hits: number;
  misses: number;
  size: number;
  type: "memory" | "redis";
}

/**
 * TokenCacheStore contract interface.
 *
 * Implementations provide TTL-aware token caching, plus scan and stats
 * primitives that generic key-value caches do not require.
 */
export interface TokenCacheStore {
  /** Retrieve a cached entry by key. Returns `null` on miss or expiry. */
  get(key: string): Promise<TokenCacheEntry | null>;
  /** Store an entry. TTL is derived from `entry.expiresAt`. */
  set(key: string, entry: TokenCacheEntry): Promise<void>;
  /** Delete a cached entry. No-op if the key does not exist. */
  delete(key: string): Promise<void>;
  /** Remove every entry owned by this store. */
  clear(): Promise<void>;
  /** Check whether a non-expired entry exists for the given key. */
  has(key: string): Promise<boolean>;
  /** Return current hit/miss/size statistics. */
  stats(): Promise<TokenCacheStats>;
  /** Close connections and release resources. */
  close(): Promise<void>;
}
