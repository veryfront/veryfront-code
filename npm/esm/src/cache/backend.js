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
import * as dntShim from "../../_dnt.shims.js";
import { logger } from "../utils/index.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
import { SpanNames } from "../observability/tracing/span-names.js";
import { getRedisClient, isRedisConfigured } from "../utils/redis-client.js";
import { runtime } from "../platform/adapters/registry.js";
import { tryGetCacheKeyContext } from "./cache-key-builder.js";
import { getRuntimeEnv, isRuntimeEnvInitialized } from "../config/runtime-env.js";
import { CircuitBreakerOpen, getCircuitBreaker } from "../utils/circuit-breaker.js";
import { MEMORY_CACHE_MAX_ENTRIES } from "../utils/constants/cache.js";
// Lazy-loaded via global to avoid circular dependency
// (multi-project-adapter → proxy-manager → veryfront/index → adapter → file-cache → backend)
// The multi-project-adapter registers itself at __vf_multi_project_adapter when loaded
function getCurrentRequestContext() {
    // deno-lint-ignore no-explicit-any
    const mod = dntShim.dntGlobalThis.__vf_multi_project_adapter;
    return mod?.getCurrentRequestContext?.() ?? null;
}
const ENV_KEY_MAP = {
    VERYFRONT_API_BASE_URL: "apiBaseUrl",
    VERYFRONT_API_TOKEN: "apiToken",
};
/** Runtime-agnostic environment variable getter with RuntimeEnv support. */
function getEnvValue(key, env) {
    const runtimeEnv = env ?? (isRuntimeEnvInitialized() ? getRuntimeEnv() : null);
    if (runtimeEnv) {
        const prop = ENV_KEY_MAP[key];
        return prop ? runtimeEnv[prop] : undefined;
    }
    // Fallback for bootstrap scenarios before RuntimeEnv is initialized
    if (runtime.isInitialized())
        return runtime.getSync().env.get(key);
    // deno-lint-ignore no-explicit-any
    const g = dntShim.dntGlobalThis;
    return g.Deno?.env?.get(key) ?? g.process?.env?.[key];
}
/** Memory cache backend with TTL support. */
export class MemoryCacheBackend {
    type = "memory";
    store = new Map();
    regexCache = new Map();
    maxEntries;
    constructor(maxEntries = MEMORY_CACHE_MAX_ENTRIES) {
        this.maxEntries = maxEntries;
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return Promise.resolve(null);
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return Promise.resolve(null);
        }
        return Promise.resolve(entry.value);
    }
    getBatch(keys) {
        const results = new Map();
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
    set(key, value, ttlSeconds = 300) {
        if (this.store.size >= this.maxEntries && !this.store.has(key)) {
            const oldest = this.store.keys().next().value;
            if (oldest)
                this.store.delete(oldest);
        }
        this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
        return Promise.resolve();
    }
    setBatch(entries) {
        const now = Date.now();
        for (const { key, value, ttl } of entries) {
            if (this.store.size >= this.maxEntries && !this.store.has(key)) {
                const oldest = this.store.keys().next().value;
                if (oldest)
                    this.store.delete(oldest);
            }
            this.store.set(key, {
                value,
                expiresAt: now + (ttl ?? 300) * 1000,
            });
        }
        return Promise.resolve();
    }
    del(key) {
        this.store.delete(key);
        return Promise.resolve();
    }
    delByPattern(pattern) {
        let regex = this.regexCache.get(pattern);
        if (!regex) {
            regex = new RegExp(`^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
            if (this.regexCache.size >= 100) {
                const firstKey = this.regexCache.keys().next().value;
                if (firstKey)
                    this.regexCache.delete(firstKey);
            }
            this.regexCache.set(pattern, regex);
        }
        let deleted = 0;
        for (const key of this.store.keys()) {
            if (!regex.test(key))
                continue;
            this.store.delete(key);
            deleted++;
        }
        return Promise.resolve(deleted);
    }
    clear() {
        this.store.clear();
        this.regexCache.clear();
    }
    get size() {
        return this.store.size;
    }
}
/** Redis cache backend for local development and open source deployments. */
export class RedisCacheBackend {
    type = "redis";
    client = null;
    keyPrefix;
    constructor(keyPrefix = "vf:cache:") {
        this.keyPrefix = keyPrefix;
    }
    prefixKey(key) {
        return `${this.keyPrefix}${key}`;
    }
    initialize() {
        if (!isRedisConfigured())
            return Promise.resolve(false);
        return withSpan(SpanNames.CACHE_REDIS_INIT, async (span) => {
            try {
                this.client = await getRedisClient();
                span?.setAttribute("cache.redis.connected", true);
                return true;
            }
            catch (error) {
                span?.setAttribute("cache.redis.connected", false);
                logger.warn("[RedisCacheBackend] Failed to connect", { error });
                return false;
            }
        }, { "cache.key_prefix": this.keyPrefix });
    }
    async get(key) {
        if (!this.client)
            return null;
        try {
            return await this.client.get(this.prefixKey(key));
        }
        catch (error) {
            logger.debug("[RedisCacheBackend] Get failed", { key, error });
            return null;
        }
    }
    async getBatch(keys) {
        const results = new Map();
        if (!this.client) {
            for (const key of keys)
                results.set(key, null);
            return results;
        }
        if (keys.length === 0)
            return results;
        try {
            const fetched = await Promise.all(keys.map(async (key) => [key, await this.get(key)]));
            for (const [key, value] of fetched)
                results.set(key, value);
            return results;
        }
        catch (error) {
            logger.debug("[RedisCacheBackend] GetBatch failed", { keyCount: keys.length, error });
            for (const key of keys)
                results.set(key, null);
            return results;
        }
    }
    async set(key, value, ttlSeconds = 300) {
        if (!this.client)
            return;
        try {
            await this.client.set(this.prefixKey(key), value, { EX: ttlSeconds });
        }
        catch (error) {
            logger.debug("[RedisCacheBackend] Set failed", { key, error });
        }
    }
    async setBatch(entries) {
        if (!this.client || entries.length === 0)
            return;
        try {
            await Promise.all(entries.map(({ key, value, ttl }) => this.set(key, value, ttl ?? 300)));
        }
        catch (error) {
            logger.debug("[RedisCacheBackend] SetBatch failed", { entryCount: entries.length, error });
        }
    }
    async del(key) {
        if (!this.client)
            return;
        try {
            await this.client.del(this.prefixKey(key));
        }
        catch (error) {
            logger.debug("[RedisCacheBackend] Del failed", { key, error });
        }
    }
    async delByPattern(pattern) {
        if (!this.client)
            return 0;
        try {
            const fullPattern = this.prefixKey(pattern);
            let cursor = 0;
            const keysToDelete = [];
            do {
                const result = await this.client.scan(cursor, { MATCH: fullPattern, COUNT: 100 });
                cursor = result.cursor;
                if (result.keys.length)
                    keysToDelete.push(...result.keys);
            } while (cursor !== 0);
            if (!keysToDelete.length)
                return 0;
            return await this.client.del(keysToDelete);
        }
        catch (error) {
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
export class ApiCacheBackend {
    type = "api";
    apiBaseUrl;
    keyPrefix;
    timeoutMs;
    env;
    circuitBreaker;
    constructor(options = {}) {
        this.env = options.env;
        this.apiBaseUrl = options.apiBaseUrl ??
            getEnvValue("VERYFRONT_API_BASE_URL", this.env) ??
            "https://api.veryfront.com";
        this.keyPrefix = options.keyPrefix ?? "";
        this.timeoutMs = options.timeoutMs ?? 10000;
        // Use separate circuit breakers for different cache types to prevent
        // cascade failures from blocking critical recovery operations
        const breakerName = options.circuitBreakerName ?? "api-cache";
        this.circuitBreaker = getCircuitBreaker(breakerName, {
            failureThreshold: 10,
            resetTimeoutMs: 15000,
            successThreshold: 2,
        });
    }
    prefixKey(key) {
        return this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
    }
    getAuthToken() {
        const envToken = getEnvValue("VERYFRONT_API_TOKEN", this.env);
        if (envToken)
            return envToken;
        return getCurrentRequestContext()?.token ?? null;
    }
    getProjectSlug() {
        return tryGetCacheKeyContext()?.projectId ?? null;
    }
    async request(method, path, body) {
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
                const timeoutId = dntShim.setTimeout(() => controller.abort(), this.timeoutMs);
                try {
                    const response = await withSpan(SpanNames.HTTP_CLIENT_FETCH, () => dntShim.fetch(url, {
                        method,
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: body ? JSON.stringify(body) : undefined,
                        signal: controller.signal,
                    }), {
                        "http.method": method,
                        "http.url": url,
                        "http.host": new URL(this.apiBaseUrl).host,
                        "cache.operation": path,
                        "cache.project_slug": projectSlug,
                    });
                    if (!response.ok)
                        throw new Error(`HTTP ${response.status}`);
                    return (await response.json());
                }
                finally {
                    clearTimeout(timeoutId);
                }
            });
        }
        catch (error) {
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
    async get(key) {
        const result = await this.request("GET", `/get?key=${encodeURIComponent(this.prefixKey(key))}`);
        return result?.value ?? null;
    }
    async getBatch(keys) {
        const results = new Map();
        if (keys.length === 0)
            return results;
        const prefixedKeys = keys.map((k) => this.prefixKey(k));
        const response = await this.request("POST", "/get-batch", { keys: prefixedKeys });
        if (response?.values) {
            for (let i = 0; i < keys.length; i++) {
                const originalKey = keys[i];
                const prefixedKey = prefixedKeys[i];
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
    async getIndividually(keys) {
        const results = await Promise.all(keys.map(async (key) => [key, await this.get(key)]));
        return new Map(results);
    }
    async set(key, value, ttlSeconds = 300) {
        await this.request("POST", "/set", {
            key: this.prefixKey(key),
            value,
            ttl: ttlSeconds,
        });
    }
    async setBatch(entries) {
        if (entries.length === 0)
            return;
        const prefixedEntries = entries.map(({ key, value, ttl }) => ({
            key: this.prefixKey(key),
            value,
            ttl,
        }));
        await this.request("POST", "/set-batch", { entries: prefixedEntries });
    }
    async del(key) {
        await this.request("POST", "/del", { key: this.prefixKey(key) });
    }
    async delByPattern(pattern) {
        const result = await this.request("POST", "/del-pattern", {
            pattern: this.prefixKey(pattern),
        });
        return result?.deleted ?? 0;
    }
}
/** Check if API cache backend is available (production environment with API URL). */
export function isApiCacheAvailable(env) {
    // deno-lint-ignore no-explicit-any
    const g = dntShim.dntGlobalThis;
    const getEnvDirect = (key) => g.Deno?.env?.get(key) ?? g.process?.env?.[key];
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
export function createCacheBackend(config = {}) {
    const { keyPrefix = "", memoryMaxEntries = 500, preferredBackend, apiBaseUrl, env, circuitBreakerName, } = config;
    return withSpan(SpanNames.CACHE_BACKEND_CREATE, async (span) => {
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
    }, {
        "cache.key_prefix": keyPrefix,
        "cache.preferred_backend": preferredBackend ?? "auto",
    });
}
/**
 * Check if a cache backend supports distributed (cross-pod) caching.
 *
 * Use this instead of checking `backend.type === "memory"` directly,
 * which is a leaky abstraction that exposes implementation details.
 */
export function isDistributedBackend(backend) {
    return backend.type !== "memory";
}
/**
 * Create a lazy-initialized distributed cache accessor.
 *
 * This encapsulates the common pattern of:
 * 1. Lazy-init a cache backend via Singleflight
 * 2. Skip if memory-only (not useful for cross-pod sharing)
 * 3. Return null if init fails
 *
 * @param factory - Function that creates the cache backend
 * @param name - Log prefix for debug messages
 * @returns A function that returns the distributed cache backend or null
 */
export function createDistributedCacheAccessor(factory, name) {
    let backend;
    const singleflight = new (class {
        promise = null;
        do(fn) {
            if (!this.promise) {
                this.promise = fn().finally(() => {
                    this.promise = null;
                });
            }
            return this.promise;
        }
    })();
    return () => {
        if (backend !== undefined)
            return Promise.resolve(backend);
        return singleflight.do(async () => {
            try {
                const b = await factory();
                if (!isDistributedBackend(b)) {
                    backend = null;
                    logger.debug(`[${name}] No distributed cache available (memory only)`);
                    return null;
                }
                backend = b;
                logger.debug(`[${name}] Distributed cache initialized`, { type: b.type });
                return b;
            }
            catch (error) {
                logger.debug(`[${name}] Failed to initialize distributed cache`, { error });
                backend = null;
                return null;
            }
        });
    };
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
    /** HTTP module cache for ESM.sh modules (cross-pod sharing).
     * Uses separate circuit breaker to prevent cascade failures from blocking recovery. */
    httpModule: () => createCacheBackend({ keyPrefix: "http-module", circuitBreakerName: "api-cache-http" }),
    /** SSR module cache for React loader (cross-pod sharing). */
    ssrModule: () => createCacheBackend({ keyPrefix: "ssr-module" }),
    /** Project CSS cache for Tailwind CSS output (cross-pod sharing). */
    projectCSS: () => createCacheBackend({ keyPrefix: "project-css" }),
};
