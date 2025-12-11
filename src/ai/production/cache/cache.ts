
import type { AgentResponse } from "../../types/agent.ts";

export interface CacheConfig {
  strategy: "memory" | "lru" | "ttl";

  maxSize?: number;

  ttl?: number;

  keyGenerator?: (input: string, context?: Record<string, unknown>) => string;
}

export interface CacheEntry {
  response: AgentResponse;

  cachedAt: number;

  expiresAt?: number;

  accessCount: number;

  lastAccessedAt: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry>();

  set(key: string, response: AgentResponse): void {
    this.cache.set(key, {
      response,
      cachedAt: Date.now(),
      accessCount: 0,
      lastAccessedAt: Date.now(),
    });
  }

  get(key: string): AgentResponse | null {
    const entry = this.cache.get(key);

    if (!entry) return null;

    entry.accessCount++;
    entry.lastAccessedAt = Date.now();

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

class LRUCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  set(key: string, response: AgentResponse): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      response,
      cachedAt: Date.now(),
      accessCount: 0,
      lastAccessedAt: Date.now(),
    });
  }

  get(key: string): AgentResponse | null {
    const entry = this.cache.get(key);

    if (!entry) return null;

    this.cache.delete(key);
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();
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

class TTLCache {
  private cache = new Map<string, CacheEntry>();
  private ttl: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(ttl: number = 300000) {
    this.ttl = ttl;
    this.startCleanup();
  }

  set(key: string, response: AgentResponse): void {
    const now = Date.now();

    this.cache.set(key, {
      response,
      cachedAt: now,
      expiresAt: now + this.ttl,
      accessCount: 0,
      lastAccessedAt: now,
    });
  }

  get(key: string): AgentResponse | null {
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    entry.accessCount++;
    entry.lastAccessedAt = Date.now();

    return entry.response;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) return false;

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

export function createCache(config: CacheConfig) {
  let cache: MemoryCache | LRUCache | TTLCache;

  switch (config.strategy) {
    case "memory":
      cache = new MemoryCache();
      break;
    case "lru":
      cache = new LRUCache(config.maxSize || 100);
      break;
    case "ttl":
      cache = new TTLCache(config.ttl || 300000);
      break;
    default:
      cache = new MemoryCache();
  }

  const keyGenerator = config.keyGenerator || ((input: string) => `cache_${hashString(input)}`);

  return {
    get(input: string, context?: Record<string, unknown>): AgentResponse | null {
      const key = keyGenerator(input, context);
      return cache.get(key);
    },

    set(input: string, response: AgentResponse, context?: Record<string, unknown>): void {
      const key = keyGenerator(input, context);
      cache.set(key, response);
    },

    has(input: string, context?: Record<string, unknown>): boolean {
      const key = keyGenerator(input, context);
      return cache.has(key);
    },

    delete(input: string, context?: Record<string, unknown>): void {
      const key = keyGenerator(input, context);
      cache.delete(key);
    },

    clear(): void {
      cache.clear();
    },

    size(): number {
      return cache.size();
    },
  };
}

function hashString(str: string): string {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  return Math.abs(hash).toString(36);
}

export function cacheMiddleware(config: CacheConfig) {
  const cache = createCache(config);

  return async (
    context: Record<string, unknown>,
    next: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> => {
    const inputString = typeof context.input === "string"
      ? context.input
      : JSON.stringify(context.input);

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

    const result = await next();
    cache.set(inputString, result, context);

    return result;
  };
}
