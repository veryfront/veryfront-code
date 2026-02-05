import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { Span } from "@opentelemetry/api";
import { getRedisClient, isRedisConfigured, type RedisClient } from "../utils/redis-client.ts";
import { runtime } from "../platform/adapters/registry.ts";
import { tryGetCacheKeyContext } from "./cache-key-builder.ts";
import { getEnvironmentConfig, isEnvironmentConfigInitialized, type EnvironmentConfig } from "../config/environment-config.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "../utils/circuit-breaker.ts";
import { MEMORY_CACHE_MAX_ENTRIES } from "../utils/constants/cache.ts";
import type { CacheBackend } from "./types.ts";
import {
  type CodeCacheGateway,
  createTokenizingGateway,
  type TokenizingCacheGateway,
} from "./tokenizing-gateway.ts";

// Re-export CacheBackend interface for backward compatibility
export type { CacheBackend } from "./types.ts";
// Re-export gateway types
export type { CodeCacheGateway, TokenizingCacheGateway };

type CacheRequestContext = {
  token?: string;
  projectId?: string;
  projectSlug?: string;
};

function getCurrentRequestContext(): CacheRequestContext | null {
  // deno-lint-ignore no-explicit-any
  const mod = (globalThis as any).__vf_multi_project_adapter;
  return (mod?.getCurrentRequestContext?.() as CacheRequestContext | undefined) ?? null;
}

const ENV_KEY_MAP: Record<string, keyof EnvironmentConfig | undefined> = {
  VERYFRONT_API_BASE_URL: "apiBaseUrl",
  VERYFRONT_API_TOKEN: "apiToken",
};

function getEnvValue(key: string, env?: EnvironmentConfig): string | undefined {
  const runtimeEnv = env ?? (isEnvironmentConfigInitialized() ? getEnvironmentConfig() : null);
  if (runtimeEnv) {
    const prop = ENV_KEY_MAP[key];
    return prop ? (runtimeEnv[prop] as string | undefined) : undefined;
  }

  if (runtime.isInitialized()) return runtime.getSync().env.get(key);

  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  return g.Deno?.env?.get(key) ?? g.process?.env?.[key];
}

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
    if (keys.length === 0) return results;

    if (!this.client) {
      for (const key of keys) results.set(key, null);
      return results;
    }

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

export class ApiCacheBackend implements CacheBackend {
  readonly type = "api" as const;
  private apiBaseUrl: string;
  private keyPrefix: string;
  private timeoutMs: number;
  private env?: EnvironmentConfig;
  private circuitBreaker;

  constructor(
    options: {
      apiBaseUrl?: string;
      keyPrefix?: string;
      timeoutMs?: number;
      env?: EnvironmentConfig;
      circuitBreakerName?: string;
    } = {},
  ) {
    this.env = options.env;
    this.apiBaseUrl = options.apiBaseUrl ??
      getEnvValue("VERYFRONT_API_BASE_URL", this.env) ??
      "https://api.veryfront.com";
    this.keyPrefix = options.keyPrefix ?? "";
    this.timeoutMs = options.timeoutMs ?? 10000;

    const breakerName = options.circuitBreakerName ?? "api-cache";
    this.circuitBreaker = getCircuitBreaker(breakerName, {
      failureThreshold: 10,
      resetTimeoutMs: 15000,
      successThreshold: 2,
    });
  }

  private prefixKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T | null> {
    const reqCtx = getCurrentRequestContext();
    const envToken = getEnvValue("VERYFRONT_API_TOKEN", this.env);
    // Prefer request context token (from proxy) - this is how production works
    const token = reqCtx?.token || envToken || null;
    const tokenSource = reqCtx?.token ? "request" : envToken ? "env" : "none";
    const projectRef = reqCtx?.projectId || reqCtx?.projectSlug ||
      tryGetCacheKeyContext()?.projectId || null;

    if (!token || !projectRef) {
      logger.debug("[ApiCacheBackend] Missing auth or project context", {
        tokenSource,
        hasProjectRef: !!projectRef,
      });
      return null;
    }

    try {
      return await this.circuitBreaker.execute(async () => {
        const url = `${this.apiBaseUrl}/projects/${projectRef}/cache${path}`;
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
              "cache.project_slug": projectRef,
            },
          );

          if (!response.ok) {
            let responseBody = "";
            try {
              responseBody = await response.text();
            } catch {
              // ignore body read errors
            }
            throw new Error(`HTTP ${response.status}: ${responseBody.slice(0, 500)}`);
          }

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
        tokenSource,
        projectRef,
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

    if (!response?.values) {
      logger.debug("[ApiCacheBackend] Batch endpoint failed, falling back to individual gets", {
        keyCount: keys.length,
      });
      return this.getIndividually(keys);
    }

    for (let i = 0; i < keys.length; i++) {
      const originalKey = keys[i] as string;
      const prefixedKey = prefixedKeys[i] as string;
      results.set(originalKey, response.values[prefixedKey] ?? null);
    }

    return results;
  }

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

export interface CacheBackendConfig {
  keyPrefix?: string;
  memoryMaxEntries?: number;
  preferredBackend?: "api" | "redis" | "memory";
  apiBaseUrl?: string;
  env?: EnvironmentConfig;
  circuitBreakerName?: string;
}

export function isApiCacheAvailable(env?: EnvironmentConfig): boolean {
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

export function createCacheBackend(config: CacheBackendConfig = {}): Promise<CacheBackend> {
  const {
    keyPrefix = "",
    memoryMaxEntries = 500,
    preferredBackend,
    apiBaseUrl,
    env,
    circuitBreakerName,
  } = config;

  return withSpan(
    SpanNames.CACHE_BACKEND_CREATE,
    async (span?: Span) => {
      const shouldUseApi = preferredBackend === "api" ||
        (!preferredBackend && isApiCacheAvailable(env));
      if (shouldUseApi) {
        logger.debug("[CacheBackend] Using API backend (centralized cache)");
        span?.setAttribute("cache.backend.type", "api");
        return new ApiCacheBackend({ keyPrefix, apiBaseUrl, env, circuitBreakerName });
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

export function isDistributedBackend(backend: CacheBackend): boolean {
  return backend.type !== "memory";
}

const DISTRIBUTED_CACHE_RETRY_MS = 30_000;

export function createDistributedCacheAccessor(
  factory: () => Promise<CacheBackend>,
  name: string,
): () => Promise<CacheBackend | null> {
  let backend: CacheBackend | null | undefined;
  let lastFailureTime = 0;

  const singleflight = new (class {
    private promise: Promise<CacheBackend | null> | null = null;

    do(fn: () => Promise<CacheBackend | null>): Promise<CacheBackend | null> {
      if (!this.promise) {
        this.promise = fn().finally(() => {
          this.promise = null;
        });
      }
      return this.promise;
    }
  })();

  return () => {
    if (backend !== undefined) {
      if (
        backend === null && lastFailureTime > 0 &&
        Date.now() - lastFailureTime >= DISTRIBUTED_CACHE_RETRY_MS
      ) {
        backend = undefined;
        logger.debug(`[${name}] Retrying distributed cache initialization after failure`);
      }

      if (backend !== undefined) return Promise.resolve(backend);
    }

    return singleflight.do(async () => {
      try {
        const b = await factory();
        if (!isDistributedBackend(b)) {
          backend = null;
          lastFailureTime = 0;
          logger.debug(`[${name}] No distributed cache available (memory only)`);
          return null;
        }

        backend = b;
        lastFailureTime = 0;
        logger.debug(`[${name}] Distributed cache initialized`, { type: b.type });
        return b;
      } catch (error) {
        logger.debug(`[${name}] Failed to initialize distributed cache`, { error });
        backend = null;
        lastFailureTime = Date.now();
        return null;
      }
    });
  };
}

export const CacheBackends = {
  transform: () => createCacheBackend({ keyPrefix: "transform" }),
  file: () => createCacheBackend(),
  module: () => createCacheBackend({ keyPrefix: "module" }),
  render: () => createCacheBackend({ keyPrefix: "render" }),
  userKv: () => createCacheBackend({ keyPrefix: "kv", preferredBackend: "api" }),
  httpModule: () =>
    createCacheBackend({ keyPrefix: "http-module", circuitBreakerName: "api-cache-http" }),
  ssrModule: () => createCacheBackend({ keyPrefix: "ssr-module" }),
  projectCSS: () => createCacheBackend({ keyPrefix: "project-css" }),

  /**
   * Create a TokenizingCacheGateway for code storage.
   * This is the ONLY authorized way to store transformed code in distributed cache.
   *
   * The gateway automatically handles:
   * - Tokenization on write (replaces absolute paths with __VF_CACHE_DIR__)
   * - Detokenization on read (replaces tokens with local paths)
   * - Validation to ensure code is portable before storage
   *
   * @param name - Name for logging (e.g., "TRANSFORM-CACHE", "SSR-MODULE")
   * @param config - Cache backend configuration
   * @returns A gateway that enforces tokenization for code storage
   */
  codeStore: async (
    name: string,
    config: CacheBackendConfig = {},
  ): Promise<TokenizingCacheGateway> => {
    const backend = await createCacheBackend(config);
    return createTokenizingGateway(backend, name);
  },
};

/**
 * Create a distributed cache accessor that returns a TokenizingCacheGateway.
 * This wraps createDistributedCacheAccessor with automatic gateway creation.
 */
export function createDistributedCodeCacheAccessor(
  factory: () => Promise<CacheBackend>,
  name: string,
): () => Promise<TokenizingCacheGateway | null> {
  const baseAccessor = createDistributedCacheAccessor(factory, name);

  return async () => {
    const backend = await baseAccessor();
    if (!backend) return null;
    return createTokenizingGateway(backend, name);
  };
}

// Re-export createTokenizingGateway for convenience
export { createTokenizingGateway };
