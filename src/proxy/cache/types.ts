/**
 * Token Cache Interface
 *
 * Abstraction for storing OAuth tokens with TTL support.
 * Implementations: MemoryCache (built in) or an explicitly activated extension.
 */

export interface TokenCacheEntry {
  token: string;
  expiresAt: number; // Unix timestamp in ms
  scope: "preview" | "production";
  projectSlug?: string;
}

export interface TokenCache {
  get(key: string): Promise<TokenCacheEntry | null>;
  set(key: string, entry: TokenCacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
  stats(): Promise<CacheStats>;
  close(): Promise<void>;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  type: "memory" | "extension";
}

export interface MemoryCacheOptions {
  /** Maximum number of entries. Must be between 1 and 100,000. */
  maxSize?: number;
  /** Expiry sweep interval in milliseconds. `0` disables scheduled sweeps. */
  cleanupInterval?: number;
}

export type CacheOptions =
  | { type: "memory"; options?: MemoryCacheOptions }
  | {
    /** Requires a previously registered `TokenCacheStore` extension contract. */
    type: "extension";
    options?: never;
  };
