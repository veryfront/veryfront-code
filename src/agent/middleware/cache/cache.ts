import type { AgentMiddleware, AgentResponse } from "../../types.ts";
import { setActiveSpanAttributes, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const DEFAULT_LRU_MAX_SIZE = 100;
const DEFAULT_TTL_MS = 300_000; // 5 minutes
const TTL_CLEANUP_INTERVAL_MS = 60_000;

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

function createCacheEntry(response: AgentResponse, expiresAt?: number): CacheEntry {
  const now = Date.now();
  return { response, cachedAt: now, expiresAt, accessCount: 0, lastAccessedAt: now };
}

function markAccessed(entry: CacheEntry): void {
  entry.accessCount++;
  entry.lastAccessedAt = Date.now();
}

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

class LRUCache {
  private cache = new Map<string, CacheEntry>();

  constructor(private maxSize: number = DEFAULT_LRU_MAX_SIZE) {}

  set(key: string, response: AgentResponse): void {
    if (this.cache.has(key)) this.cache.delete(key);

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }

    this.cache.set(key, createCacheEntry(response));
  }

  get(key: string): AgentResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

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

class TTLCache {
  private cache = new Map<string, CacheEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private ttl?: number) {
    this.ttl = this.ttl && this.ttl > 0 ? this.ttl : undefined;
    if (this.ttl !== undefined) this.startCleanup();
  }

  set(key: string, response: AgentResponse): void {
    const expiresAt = this.ttl !== undefined ? Date.now() + this.ttl : undefined;
    this.cache.set(key, createCacheEntry(response, expiresAt));
  }

  get(key: string): AgentResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }

    markAccessed(entry);
    return entry.response;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (this.isExpired(entry)) {
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

  private isExpired(entry: CacheEntry): boolean {
    return entry.expiresAt !== undefined && Date.now() >= entry.expiresAt;
  }

  private startCleanup(): void {
    if (this.ttl === undefined) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
          this.cache.delete(key);
        }
      }
    }, TTL_CLEANUP_INTERVAL_MS);
  }
}

type CacheInstance = Pick<MemoryCache, "set" | "get" | "has" | "delete" | "clear" | "size">;

function createCacheByStrategy(config: CacheConfig): CacheInstance {
  switch (config.strategy) {
    case "lru":
      return new LRUCache(config.maxSize ?? DEFAULT_LRU_MAX_SIZE);
    case "ttl":
      return new TTLCache(config.ttl ?? DEFAULT_TTL_MS);
    default:
      return new MemoryCache();
  }
}

export function createCache(config: CacheConfig): {
  get(input: string, context?: Record<string, unknown>): AgentResponse | null;
  set(input: string, response: AgentResponse, context?: Record<string, unknown>): void;
  has(input: string, context?: Record<string, unknown>): boolean;
  delete(input: string, context?: Record<string, unknown>): void;
  clear(): void;
  size(): number;
  destroy(): void;
} {
  const cache = createCacheByStrategy(config);
  const keyGenerator = config.keyGenerator ?? defaultKeyGenerator;

  function keyFor(input: string, context?: Record<string, unknown>): string {
    return keyGenerator(input, context);
  }

  return {
    get(input, context) {
      return cache.get(keyFor(input, context));
    },
    set(input, response, context) {
      cache.set(keyFor(input, context), response);
    },
    has(input, context) {
      return cache.has(keyFor(input, context));
    },
    delete(input, context) {
      cache.delete(keyFor(input, context));
    },
    clear() {
      cache.clear();
    },
    size() {
      return cache.size();
    },
    destroy() {
      if ("destroy" in cache && typeof cache.destroy === "function") {
        cache.destroy();
      } else {
        cache.clear();
      }
    },
  };
}

function hashString(str: string): string {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash &= hash;
  }

  return Math.abs(hash).toString(36);
}

/**
 * Default key generator that includes project context to prevent multi-tenant
 * cache leakage. If projectId is available in context, it's prepended to the key.
 * This ensures different projects cannot share cached agent responses.
 *
 * @see plans/architecture-audit/013.2-agent-cache-project-isolation.md
 */
function defaultKeyGenerator(input: string, context?: Record<string, unknown>): string {
  const inputHash = hashString(input);

  const projectId = context?.projectId ??
    (context?.project as Record<string, unknown> | undefined)?.id ??
    (context?.renderContext as Record<string, unknown> | undefined)?.projectId;

  if (typeof projectId === "string" && projectId) {
    return `cache_${projectId}:${inputHash}`;
  }

  return `cache_${inputHash}`;
}

export function cacheMiddleware(
  config: CacheConfig,
): AgentMiddleware & { destroy(): void } {
  const cache = createCache(config);

  const middleware = ((context, next) =>
    withSpan(
      "agent.middleware.cache",
      async () => {
        const inputString = typeof context.input === "string"
          ? context.input
          : JSON.stringify(context.input);

        const cached = cache.get(inputString, context);
        if (cached) {
          setActiveSpanAttributes({ "cache.hit": true, "cache.strategy": config.strategy });

          return {
            ...cached,
            metadata: {
              ...cached.metadata,
              fromCache: true,
              cachedAt: Date.now(),
            },
          };
        }

        setActiveSpanAttributes({ "cache.hit": false, "cache.strategy": config.strategy });

        const result = await next();
        cache.set(inputString, result, context);
        return result;
      },
      { "cache.strategy": config.strategy },
    )) as AgentMiddleware & { destroy(): void };

  middleware.destroy = () => {
    cache.destroy();
  };

  return middleware;
}
