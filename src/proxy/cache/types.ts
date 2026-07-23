/**
 * Token Cache Interface
 *
 * Abstraction for storing OAuth tokens with TTL support.
 * Implementations: MemoryCache (built-in), RedisCache (via @veryfront/ext-cache-redis)
 */

/** Immutable OAuth token value stored by a {@link TokenCache}. */
export interface TokenCacheEntry {
  /** Access token. */
  readonly token: string;
  /** Expiry as a Unix timestamp in milliseconds. */
  readonly expiresAt: number;
  /** Runtime scope in which the token is valid. */
  readonly scope: "preview" | "production";
  /** Project slug or custom-domain identity associated with the token. */
  readonly projectSlug?: string;
}

/** TTL-aware cache contract used by the proxy token manager. */
export interface TokenCache {
  /** Return a non-expired entry or `null`. */
  get(key: string): Promise<TokenCacheEntry | null>;
  /** Store an entry using its absolute expiry. */
  set(key: string, entry: TokenCacheEntry): Promise<void>;
  /** Delete one entry. */
  delete(key: string): Promise<void>;
  /** Delete all entries and reset implementation statistics when supported. */
  clear(): Promise<void>;
  /** Return whether a non-expired entry exists. */
  has(key: string): Promise<boolean>;
  /** Return an implementation statistics snapshot. */
  stats(): Promise<CacheStats>;
  /** Release timers, connections, and retained entries. */
  close(): Promise<void>;
}

/** Aggregate cache statistics. */
export interface CacheStats {
  /** Successful lookups. */
  readonly hits: number;
  /** Missing or expired lookups. */
  readonly misses: number;
  /** Current non-expired entry count when the implementation can determine it. */
  readonly size: number;
  /** Active storage implementation. */
  readonly type: "memory" | "redis";
}

/** Resource limits for {@link MemoryCache}. */
export interface MemoryCacheOptions {
  /** Maximum number of entries. */
  readonly maxSize?: number;
  /** Milliseconds between background expiry sweeps. */
  readonly cleanupInterval?: number;
}

/** Legacy Redis selection options retained for source compatibility. */
export interface RedisCacheOptions {
  /** Redis connection URL. The registered extension owns connection setup. */
  readonly url: string;
  /** Key prefix. */
  readonly prefix?: string;
  /** Connection timeout in milliseconds. */
  readonly connectTimeout?: number;
  /** Whether the connection requires TLS. */
  readonly tls?: boolean;
  /** Optional password. */
  readonly password?: string;
  /** Optional username. */
  readonly username?: string;
}

/** Cache factory selection. */
export type CacheOptions =
  | { readonly type: "memory"; readonly options?: MemoryCacheOptions }
  | { readonly type: "redis"; readonly options: RedisCacheOptions };
