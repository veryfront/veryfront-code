/**
 * Token Cache Interface
 *
 * Abstraction for storing OAuth tokens with TTL support.
 * Implementations: MemoryCache, RedisCache
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
  type: "memory" | "redis";
}

export interface MemoryCacheOptions {
  maxSize?: number; // Maximum number of entries
  cleanupInterval?: number; // Interval in ms to cleanup expired entries
}

export interface RedisCacheOptions {
  url: string;
  prefix?: string;
  connectTimeout?: number;
}

export type CacheOptions =
  | { type: "memory"; options?: MemoryCacheOptions }
  | { type: "redis"; options: RedisCacheOptions };
