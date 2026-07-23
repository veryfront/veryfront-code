import type { AgentMiddleware, AgentResponse } from "../../types.ts";
import { setActiveSpanAttributes } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

const DEFAULT_LRU_MAX_SIZE = 100;
const DEFAULT_CACHE_MAX_SIZE = 10_000;
const MAX_CACHE_SIZE = 1_000_000;
const DEFAULT_TTL_MS = 300_000; // 5 minutes
const TTL_CLEANUP_INTERVAL_MS = 60_000;
const MAX_CACHE_KEY_LENGTH = 8_192;

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

type ResolvedCacheConfig = Readonly<
  Required<Pick<CacheConfig, "strategy" | "maxSize">> & {
    ttl?: number;
    keyGenerator: NonNullable<CacheConfig["keyGenerator"]>;
  }
>;

function positiveSafeInteger(value: unknown, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw INVALID_ARGUMENT.create({
      detail: `${name} must be a positive safe integer no greater than ${maximum}`,
    });
  }
  return value as number;
}

function normalizeCacheConfig(config: CacheConfig): ResolvedCacheConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw INVALID_ARGUMENT.create({ detail: "Agent cache configuration must be an object" });
  }
  if (config.strategy !== "memory" && config.strategy !== "lru" && config.strategy !== "ttl") {
    throw INVALID_ARGUMENT.create({ detail: "Agent cache strategy is not supported" });
  }
  if (config.keyGenerator !== undefined && typeof config.keyGenerator !== "function") {
    throw INVALID_ARGUMENT.create({ detail: "Agent cache keyGenerator must be a function" });
  }

  const defaultMaxSize = config.strategy === "lru" ? DEFAULT_LRU_MAX_SIZE : DEFAULT_CACHE_MAX_SIZE;
  const ttl = config.strategy === "ttl"
    ? positiveSafeInteger(
      config.ttl ?? DEFAULT_TTL_MS,
      "ttl",
      Number.MAX_SAFE_INTEGER - Date.now(),
    )
    : undefined;
  return Object.freeze({
    strategy: config.strategy,
    maxSize: positiveSafeInteger(config.maxSize ?? defaultMaxSize, "maxSize", MAX_CACHE_SIZE),
    ...(ttl === undefined ? {} : { ttl }),
    keyGenerator: config.keyGenerator ?? defaultKeyGenerator,
  });
}

function cloneAgentResponse(response: AgentResponse): AgentResponse {
  try {
    return structuredClone(response);
  } catch (error) {
    throw INVALID_ARGUMENT.create({
      detail: "Cached agent responses must contain structured-cloneable values",
      cause: error,
    });
  }
}

function createCacheEntry(response: AgentResponse, expiresAt?: number): CacheEntry {
  const now = Date.now();
  return {
    response: cloneAgentResponse(response),
    cachedAt: now,
    expiresAt,
    accessCount: 0,
    lastAccessedAt: now,
  };
}

function markAccessed(entry: CacheEntry): void {
  entry.accessCount++;
  entry.lastAccessedAt = Date.now();
}

class MemoryCache {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly maxSize: number) {}

  set(key: string, response: AgentResponse): void {
    if (this.cache.has(key)) this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, createCacheEntry(response));
  }

  get(key: string): AgentResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    markAccessed(entry);
    return cloneAgentResponse(entry.response);
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

  constructor(private readonly maxSize: number) {}

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

    return cloneAgentResponse(entry.response);
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

  constructor(
    private readonly ttl: number,
    private readonly maxSize: number,
  ) {
    this.startCleanup();
  }

  set(key: string, response: AgentResponse): void {
    if (this.cache.has(key)) this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    const expiresAt = Date.now() + this.ttl;
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
    return cloneAgentResponse(entry.response);
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
    this.removeExpired();
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
    this.cleanupInterval = setInterval(() => this.removeExpired(), TTL_CLEANUP_INTERVAL_MS);

    // Unref so this timer does not keep the process alive when all other work
    // is done. destroy() handles explicit cleanup when the cache is torn down.
    const interval = this.cleanupInterval as { unref?: () => void };
    interval.unref?.();
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

type CacheInstance = Pick<MemoryCache, "set" | "get" | "has" | "delete" | "clear" | "size">;

function createCacheByStrategy(config: ResolvedCacheConfig): CacheInstance {
  switch (config.strategy) {
    case "lru":
      return new LRUCache(config.maxSize);
    case "ttl":
      return new TTLCache(config.ttl ?? DEFAULT_TTL_MS, config.maxSize);
    default:
      return new MemoryCache(config.maxSize);
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
  const resolvedConfig = normalizeCacheConfig(config);
  const cache = createCacheByStrategy(resolvedConfig);
  const keyGenerator = resolvedConfig.keyGenerator;

  function keyFor(input: string, context?: Record<string, unknown>): string {
    const key = keyGenerator(input, context);
    if (typeof key !== "string" || key.length === 0 || key.length > MAX_CACHE_KEY_LENGTH) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Agent cache keys must be non-empty strings no longer than ${MAX_CACHE_KEY_LENGTH} characters`,
      });
    }
    return key;
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

// FNV-1a 64-bit hash — far fewer collisions than a 32-bit DJB2 for the long
// prompt strings used as cache keys. BigInt keeps arithmetic exact across the
// full 64-bit range without overflow.
function hashString(str: string): string {
  const FNV_OFFSET_BASIS = 14695981039346656037n;
  const FNV_PRIME = 1099511628211n;
  const MASK_64 = (1n << 64n) - 1n;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }

  return hash.toString(36);
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
  const resolvedConfig = normalizeCacheConfig(config);
  const cache = createCache(resolvedConfig);

  const middleware = ((context, next) =>
    withSpan(
      "agent.middleware.cache",
      async () => {
        const inputString = typeof context.input === "string"
          ? context.input
          : JSON.stringify(context.input);

        const cached = cache.get(inputString, context);
        if (cached) {
          setActiveSpanAttributes({ "cache.hit": true, "cache.strategy": resolvedConfig.strategy });

          return {
            ...cached,
            metadata: {
              ...cached.metadata,
              fromCache: true,
              cachedAt: Date.now(),
            },
          };
        }

        setActiveSpanAttributes({ "cache.hit": false, "cache.strategy": resolvedConfig.strategy });

        const result = await next();
        cache.set(inputString, result, context);
        return result;
      },
      { "cache.strategy": resolvedConfig.strategy },
    )) as AgentMiddleware & { destroy(): void };

  middleware.destroy = () => {
    cache.destroy();
  };

  return middleware;
}
