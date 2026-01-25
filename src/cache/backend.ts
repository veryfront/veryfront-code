/**
 * Cache Backend Abstraction
 *
 * Unified interface for cache backends:
 * - Memory: Local in-memory cache (fallback)
 * - Redis: Direct Redis access (local dev / open source)
 * - API: Centralized cache via veryfront-api (production)
 *
 * Performance features:
 * - Circuit breaker on API backend to prevent cascade failures
 * - Configurable limits for high-traffic scaling
 */

import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { Span } from "npm:@opentelemetry/api@1.9.0";
import { getRedisClient, isRedisConfigured, type RedisClient } from "../utils/redis-client.ts";
import { runtime } from "../platform/adapters/registry.ts";
import { tryGetCacheKeyContext } from "./cache-key-builder.ts";
import { getRuntimeEnv, isRuntimeEnvInitialized, type RuntimeEnv } from "../config/runtime-env.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "../utils/circuit-breaker.ts";
import { MEMORY_CACHE_MAX_ENTRIES } from "../utils/constants/cache.ts";

// Lazy-loaded via global to avoid circular dependency
// (multi-project-adapter → proxy-manager → veryfront/index → adapter → file-cache → backend)
// The multi-project-adapter registers itself at __vf_multi_project_adapter when loaded
function getCurrentRequestContext(): { token?: string } | null {
  // deno-lint-ignore no-explicit-any
  const mod = (globalThis as any).__vf_multi_project_adapter;
  return mod?.getCurrentRequestContext?.() ?? null;
}

const ENV_KEY_MAP: Record<string, keyof RuntimeEnv | undefined> = {
  VERYFRONT_API_BASE_URL: "apiBaseUrl",
  VERYFRONT_API_TOKEN: "apiToken",
};

/** Runtime-agnostic environment variable getter with RuntimeEnv support. */
function getEnvValue(key: string, env?: RuntimeEnv): string | undefined {
  const runtimeEnv = env ?? (isRuntimeEnvInitialized() ? getRuntimeEnv() : null);
  if (runtimeEnv) {
    const prop = ENV_KEY_MAP[key];
    return prop ? (runtimeEnv[prop] as string | undefined) : undefined;
  }

  // Fallback for bootstrap scenarios before RuntimeEnv is initialized
  if (runtime.isInitialized()) return runtime.getSync().env.get(key);

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

  /** Get multiple values from cache (batch operation) */
  getBatch?(keys: string[]): Promise<Map<string, string | null>>;

  /** Set a value in cache with optional TTL (seconds) */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /** Set multiple values in cache (batch operation) */
  setBatch?(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void>;

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
  private regexCache = new Map<string, RegExp>();
  private maxEntries: number;

  constructor(maxEntries = MEMORY_CACHE_MAX_ENTRIES) {
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

  getBatch(keys: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    const now = Date.now();

    for (const key of keys) {
      const entry = this.store.get(key);
      if (!entry) {
        results.set(key, null);
        continue;
      }

      if (now > entry.expiresAt) {
        this.store.delete(key);
        results.set(key, null);
        continue;
      }

      results.set(key, entry.value);
    }

    return Promise.resolve(results);
  }

  set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = this.store.keys().next().value as string | undefined;
      if (oldest) this.store.delete(oldest);
    }

    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    const now = Date.now();

    for (const { key, value, ttl } of entries) {
      if (this.store.size >= this.maxEntries && !this.store.has(key)) {
        const oldest = this.store.keys().next().value as string | undefined;
        if (oldest) this.store.delete(oldest);
      }

      this.store.set(key, {
        value,
        expiresAt: now + (ttl ?? 300) * 1000,
      });
    }

    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  delByPattern(pattern: string): Promise<number> {
    let regex = this.regexCache.get(pattern);
    if (!regex) {
      regex = new RegExp(`^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);

      if (this.regexCache.size >= 100) {
        const firstKey = this.regexCache.keys().next().value as string | undefined;
        if (firstKey) this.regexCache.delete(firstKey);
      }

      this.regexCache.set(pattern, regex);
    }

    let deleted = 0;
    for (const key of this.store.keys()) {
      if (!regex.test(key)) continue;
      this.store.delete(key);
      deleted++;
    }

    return Promise.resolve(deleted);
  }

  clear(): void {
    this.store.clear();
    this.regexCache.clear();
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

  initialize(): Promise<boolean> {
    if (!isRedisConfigured()) return Promise.resolve(false);

    return withSpan(
      SpanNames.CACHE_REDIS_INIT,
      async (span?: Span) => {
        try {
          this.client = await getRedisClient();
          span?.setAttribute("cache.redis.connected", true);
          return true;
        } catch (error) {
          span?.setAttribute("cache.redis.connected", false);
          logger.warn("[RedisCacheBackend] Failed to connect", { error });
          return false;
        }
      },
      { "cache.key_prefix": this.keyPrefix },
    );
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

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    if (!this.client) {
      for (const key of keys) results.set(key, null);
      return results;
    }
    if (keys.length === 0) return results;

    try {
      const fetched = await Promise.all(
        keys.map(async (key) => [key, await this.get(key)] as const),
      );
      for (const [key, value] of fetched) results.set(key, value);
      return results;
    } catch (error) {
      logger.debug("[RedisCacheBackend] GetBatch failed", { keyCount: keys.length, error });
      for (const key of keys) results.set(key, null);
      return results;
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

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    if (!this.client || entries.length === 0) return;

    try {
      await Promise.all(entries.map(({ key, value, ttl }) => this.set(key, value, ttl ?? 300)));
    } catch (error) {
      logger.debug("[RedisCacheBackend] SetBatch failed", { entryCount: entries.length, error });
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
      const keysToDelete: string[] = [];

      do {
        const result = await this.client.scan(cursor, { MATCH: fullPattern, COUNT: 100 });
        cursor = result.cursor;
        if (result.keys.length) keysToDelete.push(...result.keys);
      } while (cursor !== 0);

      if (!keysToDelete.length) return 0;
      return await this.client.del(keysToDelete);
    } catch (error) {
      logger.debug("[RedisCacheBackend] DelByPattern failed", { pattern, error });
      return 0;
    }
  }
}

/**
 * API cache backend for production.
 * Uses veryfront-api for centralized, project-scoped cache management.
 * Includes circuit breaker to prevent cascade failures when API is degraded.
 */
export class ApiCacheBackend implements CacheBackend {
  readonly type = "api" as const;
  private apiBaseUrl: string;
  private keyPrefix: string;
  private timeoutMs: number;
  private env?: RuntimeEnv;
  private circuitBreaker = getCircuitBreaker("api-cache", {
    failureThreshold: 10,
    resetTimeoutMs: 15000,
    successThreshold: 2,
  });

  constructor(options: {
    apiBaseUrl?: string;
    keyPrefix?: string;
    timeoutMs?: number;
    /** Optional RuntimeEnv for test isolation */
    env?: RuntimeEnv;
  } = {}) {
    this.env = options.env;
    this.apiBaseUrl = options.apiBaseUrl ??
      getEnvValue("VERYFRONT_API_BASE_URL", this.env) ??
      "https://api.veryfront.com";
    this.keyPrefix = options.keyPrefix ?? "";
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  private prefixKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
  }

  private getAuthToken(): string | null {
    const envToken = getEnvValue("VERYFRONT_API_TOKEN", this.env);
    if (envToken) return envToken;

    return getCurrentRequestContext()?.token ?? null;
  }

  private getProjectSlug(): string | null {
    return tryGetCacheKeyContext()?.projectId ?? null;
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

    try {
      return await this.circuitBreaker.execute(async () => {
        const url = `${this.apiBaseUrl}/projects/${projectSlug}/cache${path}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const response = await withSpan(
            SpanNames.HTTP_CLIENT_FETCH,
            () =>
              fetch(url, {
                method,
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
              }),
            {
              "http.method": method,
              "http.url": url,
              "http.host": new URL(this.apiBaseUrl).host,
              "cache.operation": path,
              "cache.project_slug": projectSlug,
            },
          );

          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return (await response.json()) as T;
        } finally {
          clearTimeout(timeoutId);
        }
      });
    } catch (error) {
      if (error instanceof CircuitBreakerOpen) {
        logger.info("[ApiCacheBackend] Circuit breaker open, failing fast", {
          path,
          nextAttemptMs: error.nextAttemptMs,
        });
        return null;
      }

      const isTimeout = error instanceof Error && error.name === "AbortError";
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.info(`[ApiCacheBackend] Request ${isTimeout ? "timeout" : "error"}`, {
        path,
        error: errorMsg,
        isTimeout,
      });
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

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    if (keys.length === 0) return results;

    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    const response = await this.request<{ values: Record<string, string | null> }>(
      "POST",
      "/get-batch",
      { keys: prefixedKeys },
    );

    if (response?.values) {
      for (let i = 0; i < keys.length; i++) {
        const originalKey = keys[i] as string;
        const prefixedKey = prefixedKeys[i] as string;
        results.set(originalKey, response.values[prefixedKey] ?? null);
      }
      return results;
    }

    // Batch endpoint failed - fall back to individual gets
    // This handles deployment rollouts where batch endpoint isn't available yet
    logger.debug("[ApiCacheBackend] Batch endpoint failed, falling back to individual gets", {
      keyCount: keys.length,
    });
    return this.getIndividually(keys);
  }

  /** Helper to fetch keys individually (used as fallback when batch fails). */
  private async getIndividually(keys: string[]): Promise<Map<string, string | null>> {
    const results = await Promise.all(keys.map(async (key) => [key, await this.get(key)] as const));
    return new Map(results);
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    await this.request("POST", "/set", {
      key: this.prefixKey(key),
      value,
      ttl: ttlSeconds,
    });
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    if (entries.length === 0) return;

    const prefixedEntries = entries.map(({ key, value, ttl }) => ({
      key: this.prefixKey(key),
      value,
      ttl,
    }));

    await this.request("POST", "/set-batch", { entries: prefixedEntries });
  }

  async del(key: string): Promise<void> {
    await this.request("POST", "/del", { key: this.prefixKey(key) });
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
  /** Optional RuntimeEnv for test isolation */
  env?: RuntimeEnv;
}

/** Check if API cache backend is available (production environment with API URL). */
export function isApiCacheAvailable(env?: RuntimeEnv): boolean {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const getEnvDirect = (key: string) => g.Deno?.env?.get(key) ?? g.process?.env?.[key];

  const proxyMode = getEnvDirect("PROXY_MODE");
  const nodeEnv = getEnvDirect("NODE_ENV");
  const apiUrl = getEnvValue("VERYFRONT_API_BASE_URL", env);

  const isProduction = proxyMode === "1" ||
    nodeEnv === "production" ||
    !!(apiUrl && !apiUrl.includes("localhost") && !apiUrl.includes("lvh.me"));

  return isProduction && !!apiUrl;
}

/**
 * Create cache backend based on environment.
 * Preference: API (production) > Redis (local/OSS) > Memory (fallback)
 */
export function createCacheBackend(config: CacheBackendConfig = {}): Promise<CacheBackend> {
  const { keyPrefix = "", memoryMaxEntries = 500, preferredBackend, apiBaseUrl, env } = config;

  return withSpan(
    SpanNames.CACHE_BACKEND_CREATE,
    async (span?: Span) => {
      const shouldUseApi = preferredBackend === "api" ||
        (!preferredBackend && isApiCacheAvailable(env));
      if (shouldUseApi) {
        logger.debug("[CacheBackend] Using API backend (centralized cache)");
        span?.setAttribute("cache.backend.type", "api");
        return new ApiCacheBackend({ keyPrefix, apiBaseUrl, env });
      }

      const shouldUseRedis = preferredBackend === "redis" ||
        (!preferredBackend && isRedisConfigured());
      if (shouldUseRedis) {
        const redisBackend = new RedisCacheBackend(keyPrefix ? `vf:${keyPrefix}:` : "vf:cache:");
        if (await redisBackend.initialize()) {
          logger.debug("[CacheBackend] Using Redis backend");
          span?.setAttribute("cache.backend.type", "redis");
          return redisBackend;
        }
      }

      logger.debug("[CacheBackend] Using memory backend");
      span?.setAttribute("cache.backend.type", "memory");
      return new MemoryCacheBackend(memoryMaxEntries);
    },
    {
      "cache.key_prefix": keyPrefix,
      "cache.preferred_backend": preferredBackend ?? "auto",
    },
  );
}

/** Convenience wrappers for common cache patterns. */
export const CacheBackends = {
  /** Transform cache for compiled code. */
  transform: () => createCacheBackend({ keyPrefix: "transform" }),

  /** File cache for file content. Keys already include "file:" prefix from buildFileCacheKeyPrefix. */
  file: () => createCacheBackend(),

  /** Module cache for SSR modules. */
  module: () => createCacheBackend({ keyPrefix: "module" }),

  /** Render cache for rendered pages. */
  render: () => createCacheBackend({ keyPrefix: "render" }),

  /** User KV store - always uses API backend. */
  userKv: () => createCacheBackend({ keyPrefix: "kv", preferredBackend: "api" }),

  /** HTTP module cache for ESM.sh modules (cross-pod sharing). */
  httpModule: () => createCacheBackend({ keyPrefix: "http-module" }),

  /** Project CSS cache for Tailwind CSS output (cross-pod sharing). */
  projectCSS: () => createCacheBackend({ keyPrefix: "project-css" }),
};
