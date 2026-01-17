/**
 * Cache Backend Abstraction
 *
 * Unified interface for cache backends:
 * - Memory: Local in-memory cache (fallback)
 * - Redis: Direct Redis access (local dev / open source)
 * - API: Centralized cache via veryfront-api (production)
 */

import { logger } from "@veryfront/utils";
import { runtime } from "../../platform/adapters/registry.ts";
import { tryGetCacheKeyContext } from "./cache-key-builder.ts";

/** Runtime-agnostic environment variable getter. */
function getEnv(key: string): string | undefined {
  if (runtime.isInitialized()) {
    return runtime.getSync().env.get(key);
  }
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  return g.Deno?.env?.get(key) ?? g.process?.env?.[key];
}

/** Cache backend interface. */
export interface CacheBackend {
  /** Backend type identifier */
  readonly type: "memory" | "redis" | "api";

  /** Get a value from cache */
  get(key: string): Promise<string | null>;

  /** Set a value in cache with optional TTL (seconds) */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /** Delete a key from cache */
  del(key: string): Promise<void>;

  /** Delete multiple keys matching a pattern */
  delByPattern?(pattern: string): Promise<number>;

  /** Current entry count (only available for memory backend) */
  readonly size?: number;
}

/** Memory cache backend with TTL support. */
export class MemoryCacheBackend implements CacheBackend {
  readonly type = "memory" as const;
  private store = new Map<string, { value: string; expiresAt: number }>();
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    // Evict oldest if at capacity
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  delByPattern(pattern: string): Promise<number> {
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    );
    let deleted = 0;
    for (const key of [...this.store.keys()]) {
      if (regex.test(key)) {
        this.store.delete(key);
        deleted++;
      }
    }
    return Promise.resolve(deleted);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** Redis cache backend for local development and open source deployments. */
export class RedisCacheBackend implements CacheBackend {
  readonly type = "redis" as const;
  private client: RedisClient | null = null;
  private keyPrefix: string;

  constructor(keyPrefix = "vf:cache:") {
    this.keyPrefix = keyPrefix;
  }

  private prefixKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async initialize(): Promise<boolean> {
    if (!isRedisConfigured()) {
      return false;
    }
    try {
      this.client = await getRedisClient();
      return true;
    } catch (error) {
      logger.warn("[RedisCacheBackend] Failed to connect", { error });
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.get(this.prefixKey(key));
    } catch (error) {
      logger.debug("[RedisCacheBackend] Get failed", { key, error });
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(this.prefixKey(key), value, { EX: ttlSeconds });
    } catch (error) {
      logger.debug("[RedisCacheBackend] Set failed", { key, error });
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(this.prefixKey(key));
    } catch (error) {
      logger.debug("[RedisCacheBackend] Del failed", { key, error });
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    if (!this.client) return 0;
    try {
      const fullPattern = this.prefixKey(pattern);
      let cursor = 0;
      let deleted = 0;
      const keysToDelete: string[] = [];

      do {
        const result = await this.client.scan(cursor, {
          MATCH: fullPattern,
          COUNT: 100,
        });
        cursor = result.cursor;
        if (result.keys.length > 0) {
          keysToDelete.push(...result.keys);
        }
      } while (cursor !== 0);

      if (keysToDelete.length > 0) {
        deleted = await this.client.del(keysToDelete);
      }
      return deleted;
    } catch (error) {
      logger.debug("[RedisCacheBackend] DelByPattern failed", { pattern, error });
      return 0;
    }
  }
}

// Import Redis types and functions
import { getRedisClient, isRedisConfigured, type RedisClient } from "../utils/redis-client.ts";

/**
 * API cache backend for production.
 * Uses veryfront-api for centralized, project-scoped cache management.
 */
export class ApiCacheBackend implements CacheBackend {
  readonly type = "api" as const;
  private apiBaseUrl: string;
  private keyPrefix: string;
  private timeoutMs: number;

  constructor(options: {
    apiBaseUrl?: string;
    keyPrefix?: string;
    timeoutMs?: number;
  } = {}) {
    this.apiBaseUrl = options.apiBaseUrl ||
      getEnv("VERYFRONT_API_BASE_URL") ||
      "https://api.veryfront.com";
    this.keyPrefix = options.keyPrefix || "";
    this.timeoutMs = options.timeoutMs || 5000;
  }

  private prefixKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
  }

  private getAuthToken(): string | null {
    return getEnv("VERYFRONT_API_TOKEN") || null;
  }

  private getProjectSlug(): string | null {
    return tryGetCacheKeyContext()?.projectId || null;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T | null> {
    const token = this.getAuthToken();
    const projectSlug = this.getProjectSlug();

    if (!token || !projectSlug) {
      logger.debug("[ApiCacheBackend] Missing auth or project context");
      return null;
    }

    const url = `${this.apiBaseUrl}/projects/${projectSlug}/cache${path}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.debug("[ApiCacheBackend] Request failed", {
          status: response.status,
          path,
        });
        return null;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        logger.debug("[ApiCacheBackend] Request timeout", { path });
      } else {
        logger.debug("[ApiCacheBackend] Request error", { path, error });
      }
      return null;
    }
  }

  async get(key: string): Promise<string | null> {
    const result = await this.request<{ value: string | null }>(
      "GET",
      `/get?key=${encodeURIComponent(this.prefixKey(key))}`,
    );
    return result?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    await this.request("POST", "/set", {
      key: this.prefixKey(key),
      value,
      ttl: ttlSeconds,
    });
  }

  async del(key: string): Promise<void> {
    await this.request("POST", "/del", {
      key: this.prefixKey(key),
    });
  }

  async delByPattern(pattern: string): Promise<number> {
    const result = await this.request<{ deleted: number }>("POST", "/del-pattern", {
      pattern: this.prefixKey(pattern),
    });
    return result?.deleted ?? 0;
  }
}

/** Cache backend configuration. */
export interface CacheBackendConfig {
  /** Key prefix for namespacing */
  keyPrefix?: string;
  /** Max entries for memory backend */
  memoryMaxEntries?: number;
  /** Preferred backend type (auto-detected if not specified) */
  preferredBackend?: "api" | "redis" | "memory";
  /** API base URL for API backend */
  apiBaseUrl?: string;
}

/** Check if API cache backend is available (proxy mode with API URL). */
function isApiCacheAvailable(): boolean {
  return getEnv("PROXY_MODE") === "1" && !!getEnv("VERYFRONT_API_BASE_URL");
}

/**
 * Create cache backend based on environment.
 * Preference: API (production) > Redis (local/OSS) > Memory (fallback)
 */
export async function createCacheBackend(
  config: CacheBackendConfig = {},
): Promise<CacheBackend> {
  const { keyPrefix = "", memoryMaxEntries = 500, preferredBackend, apiBaseUrl } = config;

  // If preferred backend is specified, try that first
  if (preferredBackend === "api" || (!preferredBackend && isApiCacheAvailable())) {
    logger.debug("[CacheBackend] Using API backend (centralized cache)");
    return new ApiCacheBackend({ keyPrefix, apiBaseUrl });
  }

  if (preferredBackend === "redis" || (!preferredBackend && isRedisConfigured())) {
    const redisBackend = new RedisCacheBackend(keyPrefix ? `vf:${keyPrefix}:` : "vf:cache:");
    if (await redisBackend.initialize()) {
      logger.debug("[CacheBackend] Using Redis backend");
      return redisBackend;
    }
  }

  // Fall back to memory
  logger.debug("[CacheBackend] Using memory backend");
  return new MemoryCacheBackend(memoryMaxEntries);
}

/** Convenience wrappers for common cache patterns. */
export const CacheBackends = {
  /** Transform cache for compiled code. */
  transform: () => createCacheBackend({ keyPrefix: "transform" }),

  /** File cache for file content. */
  file: () => createCacheBackend({ keyPrefix: "file" }),

  /** Module cache for SSR modules. */
  module: () => createCacheBackend({ keyPrefix: "module" }),

  /** Render cache for rendered pages. */
  render: () => createCacheBackend({ keyPrefix: "render" }),

  /** User KV store - always uses API backend. */
  userKv: () => createCacheBackend({ keyPrefix: "kv", preferredBackend: "api" }),
};
