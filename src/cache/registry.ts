import { rendererLogger as logger } from "#veryfront/utils";
import { getRedisClient, isRedisConfigured } from "#veryfront/utils/redis-client.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { Span } from "npm:@opentelemetry/api@1.9.0";

export interface CacheStore {
  readonly name: string;
  keys(): Iterable<string>;
  size(): number;
  deleteWhere?(predicate: (key: string) => boolean): number;
}

function deleteWhereFromKeys(
  keys: Iterable<string>,
  deleteKey: (key: string) => boolean,
  predicate: (key: string) => boolean,
): number {
  let deleted = 0;
  for (const key of [...keys]) {
    if (!predicate(key)) continue;
    deleteKey(key);
    deleted++;
  }
  return deleted;
}

export class MapCacheStore implements CacheStore {
  constructor(
    public readonly name: string,
    private readonly map: Map<string, unknown>,
  ) {}

  keys(): Iterable<string> {
    return this.map.keys();
  }

  size(): number {
    return this.map.size;
  }

  deleteWhere(predicate: (key: string) => boolean): number {
    return deleteWhereFromKeys(this.map.keys(), (key) => this.map.delete(key), predicate);
  }
}

interface LRULike {
  keys(): Iterable<string>;
  size: number;
  delete(key: string): boolean;
}

export class LRUCacheStore implements CacheStore {
  constructor(
    public readonly name: string,
    private readonly cache: LRULike,
  ) {}

  keys(): Iterable<string> {
    return this.cache.keys();
  }

  size(): number {
    return this.cache.size;
  }

  deleteWhere(predicate: (key: string) => boolean): number {
    return deleteWhereFromKeys(this.cache.keys(), (key) => this.cache.delete(key), predicate);
  }
}

class CacheRegistry {
  private stores = new Map<string, CacheStore>();

  register(store: CacheStore): void {
    if (this.stores.has(store.name)) {
      logger.warn(`[CacheRegistry] Replacing existing store: ${store.name}`);
    }
    this.stores.set(store.name, store);
    logger.debug(`[CacheRegistry] Registered store: ${store.name}`);
  }

  unregister(name: string): boolean {
    return this.stores.delete(name);
  }

  get(name: string): CacheStore | undefined {
    return this.stores.get(name);
  }

  getStoreNames(): string[] {
    return [...this.stores.keys()];
  }

  getAllKeys(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [name, store] of this.stores) {
      result.set(name, [...store.keys()]);
    }
    return result;
  }

  getKeysForProject(projectId: string): Map<string, string[]> {
    const result = new Map<string, string[]>();

    for (const [name, store] of this.stores) {
      const matchingKeys = [...store.keys()].filter((key) => isKeyForProject(key, projectId));
      if (matchingKeys.length) result.set(name, matchingKeys);
    }

    return result;
  }

  countKeysForProject(projectId: string): number {
    let count = 0;
    for (const store of this.stores.values()) {
      for (const key of store.keys()) {
        if (isKeyForProject(key, projectId)) count++;
      }
    }
    return count;
  }

  deleteKeysForProject(projectId: string): number {
    let totalDeleted = 0;

    for (const store of this.stores.values()) {
      totalDeleted += store.deleteWhere?.((key) => isKeyForProject(key, projectId)) ?? 0;
    }

    return totalDeleted;
  }

  /**
   * Delete cache entries for a specific project and environment.
   * Use this to invalidate preview without affecting production, or vice versa.
   */
  deleteKeysForProjectEnvironment(
    projectId: string,
    environment: "production" | "preview",
  ): number {
    let totalDeleted = 0;

    for (const store of this.stores.values()) {
      totalDeleted += store.deleteWhere?.((key) =>
        isKeyForProjectEnvironment(key, projectId, environment)
      ) ?? 0;
    }

    logger.debug("[CacheRegistry] Deleted keys for project environment", {
      projectId,
      environment,
      deleted: totalDeleted,
    });

    return totalDeleted;
  }

  /**
   * Delete cache entries for a specific content source (branch or release).
   * More granular than environment-based invalidation.
   */
  deleteKeysForContentSource(projectId: string, contentSourceId: string): number {
    let totalDeleted = 0;

    for (const store of this.stores.values()) {
      totalDeleted += store.deleteWhere?.((key) => {
        if (!isKeyForProject(key, projectId)) return false;
        return key.includes(contentSourceId);
      }) ?? 0;
    }

    logger.debug("[CacheRegistry] Deleted keys for content source", {
      projectId,
      contentSourceId,
      deleted: totalDeleted,
    });

    return totalDeleted;
  }

  getStats(): Array<{ name: string; size: number; sampleKeys: string[] }> {
    const stats: Array<{ name: string; size: number; sampleKeys: string[] }> = [];

    for (const [name, store] of this.stores) {
      const keys = [...store.keys()];
      stats.push({ name, size: store.size(), sampleKeys: keys.slice(0, 5) });
    }

    return stats;
  }

  clear(): void {
    this.stores.clear();
  }

  scanRedisKeys(pattern: string, limit = 1000): Promise<string[]> {
    if (!isRedisConfigured()) return Promise.resolve([]);

    return withSpan(
      SpanNames.CACHE_REGISTRY_SCAN_REDIS,
      async (span?: Span) => {
        try {
          const client = await getRedisClient();
          const keys: string[] = [];
          let cursor = 0;

          do {
            const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
            cursor = typeof result.cursor === "string"
              ? parseInt(result.cursor, 10)
              : result.cursor;
            keys.push(...result.keys);
          } while (cursor !== 0 && keys.length < limit);

          const resultKeys = keys.slice(0, limit);
          span?.setAttribute("cache.redis.keys_found", resultKeys.length);
          return resultKeys;
        } catch (error) {
          logger.warn("[CacheRegistry] Redis scan failed", { pattern, error });
          span?.setAttribute("cache.redis.error", true);
          return [];
        }
      },
      { "cache.redis.pattern": pattern, "cache.redis.limit": limit },
    );
  }

  getRedisKeysForProject(projectId: string): Promise<Map<string, string[]>> {
    return withSpan(
      SpanNames.CACHE_REGISTRY_GET_REDIS_KEYS,
      async (span?: Span) => {
        const result = new Map<string, string[]>();
        const prefixes = ["veryfront:ssr-module:", "veryfront:file-cache:", "veryfront:transform:"];

        let totalKeys = 0;
        for (const prefix of prefixes) {
          const keys = await this.scanRedisKeys(`${prefix}*`);
          const matchingKeys = keys.filter((key) => isKeyForProject(key, projectId));
          if (!matchingKeys.length) continue;

          result.set(prefix.replace(/:$/, ""), matchingKeys);
          totalKeys += matchingKeys.length;
        }

        span?.setAttribute("cache.redis.total_keys", totalKeys);
        span?.setAttribute("cache.redis.prefix_count", result.size);
        return result;
      },
      { "cache.project_id": projectId },
    );
  }

  getAllKeysForProjectAsync(
    projectId: string,
    includeRedis = false,
  ): Promise<{ memory: Map<string, string[]>; redis: Map<string, string[]> }> {
    return withSpan(
      SpanNames.CACHE_KEYS_GET_ALL_ASYNC,
      async (span?: Span) => {
        const memory = this.getKeysForProject(projectId);

        span?.setAttribute("cache.include_redis", includeRedis);
        if (!includeRedis) return { memory, redis: new Map() };

        const redis = await this.getRedisKeysForProject(projectId);
        return { memory, redis };
      },
      { "cache.project_id": projectId },
    );
  }

  deleteRedisKeysForProject(projectId: string): Promise<number> {
    if (!isRedisConfigured()) return Promise.resolve(0);

    return withSpan(
      SpanNames.CACHE_REGISTRY_DELETE_REDIS_KEYS,
      async (span?: Span) => {
        try {
          const client = await getRedisClient();
          const redisKeys = await this.getRedisKeysForProject(projectId);

          let deleted = 0;
          for (const keys of redisKeys.values()) {
            if (!keys.length) continue;
            deleted += await client.del(keys);
          }

          span?.setAttribute("cache.redis.deleted", deleted);
          return deleted;
        } catch (error) {
          logger.warn("[CacheRegistry] Redis delete failed", { projectId, error });
          span?.setAttribute("cache.redis.error", true);
          return 0;
        }
      },
      { "cache.project_id": projectId },
    );
  }

  deleteAllKeysForProjectAsync(projectId: string): Promise<{
    memoryDeleted: number;
    redisDeleted: number;
  }> {
    return withSpan(
      SpanNames.CACHE_KEYS_DELETE_ALL_ASYNC,
      async (span?: Span) => {
        const memoryDeleted = this.deleteKeysForProject(projectId);
        const redisDeleted = await this.deleteRedisKeysForProject(projectId);

        span?.setAttribute("cache.memory.deleted", memoryDeleted);
        span?.setAttribute("cache.redis.deleted", redisDeleted);
        return { memoryDeleted, redisDeleted };
      },
      { "cache.project_id": projectId },
    );
  }

  /**
   * Delete all cache entries for a specific project and environment (memory + Redis).
   * This is the safe way to invalidate preview without affecting production.
   */
  deleteAllKeysForProjectEnvironmentAsync(
    projectId: string,
    environment: "production" | "preview",
  ): Promise<{ memoryDeleted: number; redisDeleted: number }> {
    return withSpan(
      SpanNames.CACHE_KEYS_DELETE_ALL_ASYNC,
      async (span?: Span) => {
        const memoryDeleted = this.deleteKeysForProjectEnvironment(projectId, environment);
        const redisDeleted = await this.deleteRedisKeysForProjectEnvironment(projectId, environment);

        span?.setAttribute("cache.memory.deleted", memoryDeleted);
        span?.setAttribute("cache.redis.deleted", redisDeleted);
        span?.setAttribute("cache.environment", environment);

        logger.info("[CacheRegistry] Invalidated cache for project environment", {
          projectId,
          environment,
          memoryDeleted,
          redisDeleted,
        });

        return { memoryDeleted, redisDeleted };
      },
      { "cache.project_id": projectId, "cache.environment": environment },
    );
  }

  /**
   * Delete Redis keys for a specific project and environment.
   */
  private deleteRedisKeysForProjectEnvironment(
    projectId: string,
    environment: "production" | "preview",
  ): Promise<number> {
    if (!isRedisConfigured()) return Promise.resolve(0);

    return withSpan(
      SpanNames.CACHE_REGISTRY_DELETE_REDIS_KEYS,
      async (span?: Span) => {
        try {
          const client = await getRedisClient();
          const redisKeys = await this.getRedisKeysForProject(projectId);

          let deleted = 0;
          for (const keys of redisKeys.values()) {
            const filteredKeys = keys.filter((key) =>
              isKeyForProjectEnvironment(key, projectId, environment)
            );
            if (!filteredKeys.length) continue;
            deleted += await client.del(filteredKeys);
          }

          span?.setAttribute("cache.redis.deleted", deleted);
          span?.setAttribute("cache.environment", environment);
          return deleted;
        } catch (error) {
          logger.warn("[CacheRegistry] Redis delete for environment failed", {
            projectId,
            environment,
            error,
          });
          span?.setAttribute("cache.redis.error", true);
          return 0;
        }
      },
      { "cache.project_id": projectId, "cache.environment": environment },
    );
  }
}

export function isKeyForProject(key: string, projectId: string): boolean {
  const parts = key.split(":");
  if (parts.length < 2) return false;
  if (parts[1] === projectId) return true;
  if (parts[2] === projectId) return true;
  return parts.includes(projectId);
}

/**
 * Check if a cache key belongs to a specific project and environment.
 * Keys are expected to have format: {prefix}:{projectId}:{environment}:...
 * or {prefix}:{projectId}:{contentSourceId}:...
 */
export function isKeyForProjectEnvironment(
  key: string,
  projectId: string,
  environment: "production" | "preview",
): boolean {
  if (!isKeyForProject(key, projectId)) return false;

  const parts = key.split(":");

  // Check for explicit environment in key
  if (parts.includes(environment)) return true;

  // For production, also match keys with release IDs (rel_xxx)
  if (environment === "production") {
    return parts.some((p) => p.startsWith("rel_") || p === "latest" || p === "production");
  }

  // For preview, match branch names or "preview"
  return parts.some(
    (p) =>
      p === "preview" ||
      p === "main" ||
      p === "master" ||
      // Common branch patterns
      p.startsWith("feature-") ||
      p.startsWith("fix-") ||
      p.startsWith("dev-"),
  );
}

export function extractProjectIdFromKey(key: string): string | null {
  const parts = key.split(":");
  return parts[1] ?? null;
}

export const cacheRegistry = new CacheRegistry();

export function registerMapCache(name: string, map: Map<string, unknown>): void {
  cacheRegistry.register(new MapCacheStore(name, map));
}

export function registerLRUCache(name: string, cache: LRULike): void {
  cacheRegistry.register(new LRUCacheStore(name, cache));
}
