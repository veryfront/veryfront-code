/**
 * Response Caching System
 *
 * Cache agent responses to reduce API calls and improve performance.
 */

import type { AgentResponse } from "../../types/agent.ts";

export interface CacheConfig {
  /** Cache strategy */
  strategy: "memory" | "lru" | "ttl";

  /** Maximum cache size (for LRU) */
  maxSize?: number;

  /** Time to live in milliseconds (for TTL) */
  ttl?: number;

  /** Generate cache key */
  keyGenerator?: (input: string, context?: Record<string, unknown>) => string;
}

export interface CacheEntry {
  /** Cached response */
  response: AgentResponse;

  /** Timestamp when cached */
  cachedAt: number;

  /** Expiration timestamp (for TTL) */
  expiresAt?: number;

  /** Access count */
  accessCount: number;

  /** Last accessed timestamp */
  lastAccessedAt: number;
}

/** Creates a new cache entry with initial values */
function createCacheEntry(response: AgentResponse, expiresAt?: number): CacheEntry {
  const now = Date.now();
  return {
    response,
    cachedAt: now,
    expiresAt,
    accessCount: 0,
    lastAccessedAt: now,
  };
}

/** Updates access stats on a cache entry */
function markAccessed(entry: CacheEntry): void {
  entry.accessCount++;
  entry.lastAccessedAt = Date.now();
}

/**
 * Memory Cache (simple in-memory storage)
 */
class MemoryCache {
  private cache = new Map<string, CacheEntry>();

  set(key: string, response: AgentResponse): void {
    this.cache.set(key, createCacheEntry(response));
  }

  get(key: string): AgentResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    markAccessed(entry);
    return entry.response;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * LRU Cache (Least Recently Used eviction)
 */
class LRUCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  set(key: string, response: AgentResponse): void {
    // If key exists, delete it first (will re-add to end)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // If at max size, remove least recently used (first entry)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, createCacheEntry(response));
  }

  get(key: string): AgentResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Move to end (mark as recently used)
    this.cache.delete(key);
    markAccessed(entry);
    this.cache.set(key, entry);

    return entry.response;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * TTL Cache (Time To Live eviction)
 */
class TTLCache {
  private cache = new Map<string, CacheEntry>();
  private ttl: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(ttl: number = 300000) {
    this.ttl = ttl;
    this.startCleanup();
  }

  set(key: string, response: AgentResponse): void {
    this.cache.set(key, createCacheEntry(response, Date.now() + this.ttl));
  }

  get(key: string): AgentResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    markAccessed(entry);
    return entry.response;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) return false;

    // Check if expired
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();

      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt && now >= entry.expiresAt) {
          this.cache.delete(key);
        }
      }
    }, 60000);
  }
}

/** Factory for creating cache instances by strategy */
function createCacheByStrategy(config: CacheConfig): MemoryCache | LRUCache | TTLCache {
  if (config.strategy === "lru") {
    return new LRUCache(config.maxSize || 100);
  }
  if (config.strategy === "ttl") {
    return new TTLCache(config.ttl || 300000);
  }
  return new MemoryCache();
}

/**
 * Create a cache instance
 */
export function createCache(config: CacheConfig) {
  const cache = createCacheByStrategy(config);
  const keyGenerator = config.keyGenerator || ((input: string) => `cache_${hashString(input)}`);

  return {
    /**
     * Get cached response
     */
    get(input: string, context?: Record<string, unknown>): AgentResponse | null {
      const key = keyGenerator(input, context);
      return cache.get(key);
    },

    /**
     * Set cached response
     */
    set(input: string, response: AgentResponse, context?: Record<string, unknown>): void {
      const key = keyGenerator(input, context);
      cache.set(key, response);
    },

    /**
     * Check if cached
     */
    has(input: string, context?: Record<string, unknown>): boolean {
      const key = keyGenerator(input, context);
      return cache.has(key);
    },

    /**
     * Delete cached entry
     */
    delete(input: string, context?: Record<string, unknown>): void {
      const key = keyGenerator(input, context);
      cache.delete(key);
    },

    /**
     * Clear all cache
     */
    clear(): void {
      cache.clear();
    },

    /**
     * Get cache size
     */
    size(): number {
      return cache.size();
    },
  };
}

/**
 * Simple string hash function
 */
function hashString(str: string): string {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return Math.abs(hash).toString(36);
}

/**
 * Cache middleware for agents
 */
export function cacheMiddleware(config: CacheConfig) {
  const cache = createCache(config);

  return async (
    context: Record<string, unknown>,
    next: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> => {
    const inputString = typeof context.input === "string"
      ? context.input
      : JSON.stringify(context.input);

    // Check cache
    const cached = cache.get(inputString, context);

    if (cached) {
      return {
        ...cached,
        metadata: {
          ...cached.metadata,
          fromCache: true,
          cachedAt: Date.now(),
        },
      };
    }

    // Execute and cache
    const result = await next();
    cache.set(inputString, result, context);

    return result;
  };
}
