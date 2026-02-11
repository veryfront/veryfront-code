import { rendererLogger } from "#veryfront/utils";
import { getRedisClient, isRedisConfigured } from "#veryfront/utils/redis-client.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { Span } from "@opentelemetry/api";

const logger = rendererLogger.component("cache-registry");

export interface CacheStore {
  readonly name: string;
  get(key: string): unknown;
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
  readonly name: string;

  constructor(
    name: string,
    private readonly map: Map<string, unknown>,
  ) {
    this.name = name;
  }

  get(key: string): unknown {
    return this.map.get(key);
  }

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
  get(key: string): unknown;
  keys(): Iterable<string>;
  size: number;
  delete(key: string): boolean;
}

export class LRUCacheStore implements CacheStore {
  readonly name: string;

  constructor(
    name: string,
    private readonly cache: LRULike,
  ) {
    this.name = name;
  }

  get(key: string): unknown {
    return this.cache.get(key);
  }

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
      logger.warn(`Replacing existing store: ${store.name}`);
    }
    this.stores.set(store.name, store);
    logger.debug(`Registered store: ${store.name}`);
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

  /** Delete cache entries for a specific project and environment */
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

    logger.debug("Deleted keys for project environment", {
      projectId,
      environment,
      deleted: totalDeleted,
    });

    return totalDeleted;
  }

  /** Delete cache entries for a specific content source (branch or release) */
  deleteKeysForContentSource(projectId: string, contentSourceId: string): number {
    let totalDeleted = 0;

    for (const store of this.stores.values()) {
      totalDeleted += store.deleteWhere?.((key) =>
        isKeyForProject(key, projectId) && isKeyForContentSource(key, projectId, contentSourceId)
      ) ?? 0;
    }

    logger.debug("Deleted keys for content source", {
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
          logger.warn("Redis scan failed", { pattern, error });
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
          logger.warn("Redis delete failed", { projectId, error });
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

  /** Delete all cache entries for a specific project and environment (memory + Redis) */
  deleteAllKeysForProjectEnvironmentAsync(
    projectId: string,
    environment: "production" | "preview",
  ): Promise<{ memoryDeleted: number; redisDeleted: number }> {
    return withSpan(
      SpanNames.CACHE_KEYS_DELETE_ALL_ASYNC,
      async (span?: Span) => {
        const memoryDeleted = this.deleteKeysForProjectEnvironment(projectId, environment);
        const redisDeleted = await this.deleteRedisKeysForProjectEnvironment(
          projectId,
          environment,
        );

        span?.setAttribute("cache.memory.deleted", memoryDeleted);
        span?.setAttribute("cache.redis.deleted", redisDeleted);
        span?.setAttribute("cache.environment", environment);

        logger.info("Invalidated cache for project environment", {
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
          logger.warn("Redis delete for environment failed", {
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
  const normalizedKey = stripRedisPrefix(key);
  const parts = normalizedKey.split(":");
  if (parts.length < 2) return false;

  // Versioned cache keys: v{version}:{projectId}:...
  if (parts[0]?.startsWith("v") && parts[1] === projectId) return true;

  // Render/module cache keys where projectId is first segment and next is env/content source
  if (parts[0] === projectId) {
    if (parts[1] === "production" || parts[1] === "preview") return true;
    if (getEnvironmentFromContentSourceId(parts[1])) return true;
  }

  // Common prefixes where projectId is second segment (layout/component/proxy/etc.)
  if (parts[1] === projectId) return true;

  // File/dir/stat/list cache keys: {prefix}:{sourceType}:{projectSlug}:...
  if (parts.length > 2 && parts[2] === projectId) return true;

  return false;
}

type CacheEnvironment = "production" | "preview";

/** Check if a cache key belongs to a specific project and environment */
export function isKeyForProjectEnvironment(
  key: string,
  projectId: string,
  environment: "production" | "preview",
): boolean {
  if (!isKeyForProject(key, projectId)) return false;

  const detected = getEnvironmentFromKey(key, projectId);
  return detected === environment;
}

export function extractProjectIdFromKey(key: string): string | null {
  const parts = key.split(":");
  return parts[1] ?? null;
}

const REDIS_KEY_PREFIXES = [
  "veryfront:ssr-module:",
  "veryfront:file-cache:",
  "veryfront:transform:",
];

function stripRedisPrefix(key: string): string {
  for (const prefix of REDIS_KEY_PREFIXES) {
    if (key.startsWith(prefix)) return key.slice(prefix.length);
  }
  return key;
}

function getEnvironmentFromContentSourceId(
  contentSourceId: string | undefined,
): CacheEnvironment | null {
  if (!contentSourceId) return null;

  if (
    contentSourceId.startsWith("preview-") ||
    contentSourceId === "preview" ||
    contentSourceId === "preview-draft"
  ) {
    return "preview";
  }

  if (
    contentSourceId.startsWith("release-") ||
    contentSourceId.startsWith("production-") ||
    contentSourceId.startsWith("prod-") ||
    contentSourceId === "production" ||
    contentSourceId === "latest"
  ) {
    return "production";
  }

  return null;
}

function getEnvironmentFromKey(key: string, projectId: string): CacheEnvironment | null {
  const normalizedKey = stripRedisPrefix(key);
  const parts = normalizedKey.split(":");
  if (parts.length < 2) return null;

  // Render cache keys: {projectId}:{environment}:{releaseKey}:{version}:...
  if (parts[0] === projectId && (parts[1] === "production" || parts[1] === "preview")) {
    return parts[1] as CacheEnvironment;
  }

  // SSR module cache keys: v{version}:{projectId}:{contentSourceId}:...
  if (parts[0]?.startsWith("v") && parts[1] === projectId && parts[2]) {
    return getEnvironmentFromContentSourceId(parts[2]);
  }

  // Layout component cache keys: layout:{projectId}:{contentSourceId}:...
  if (parts[0] === "layout" && parts[1] === projectId) {
    return getEnvironmentFromContentSourceId(parts[2]);
  }

  // Proxy manager cache keys: proxy:{projectSlug}:{environment}:{qualifier}
  if (parts[0] === "proxy" && (parts[2] === "production" || parts[2] === "preview")) {
    return parts[2] as CacheEnvironment;
  }

  // File/dir/stat/list cache keys: {prefix}:{sourceType}:{projectSlug}:{qualifier}:...
  if (parts[0] === "file" || parts[0] === "stat" || parts[0] === "dir" || parts[0] === "files") {
    const sourceType = parts[1];
    if (sourceType === "branch") return "preview";
    if (sourceType === "release") return "production";
    if (sourceType === "env" && (parts[3] === "preview" || parts[3] === "production")) {
      return parts[3] as CacheEnvironment;
    }
  }

  return null;
}

function isKeyForContentSource(
  key: string,
  projectId: string,
  contentSourceId: string,
): boolean {
  const normalizedKey = stripRedisPrefix(key);
  const parts = normalizedKey.split(":");

  const candidates = new Set<string>([
    contentSourceId,
    `preview-${contentSourceId}`,
    `release-${contentSourceId}`,
    `production-${contentSourceId}`,
    `prod-${contentSourceId}`,
  ]);

  // Render cache keys: {projectId}:{environment}:{releaseKey}:{version}:...
  if (
    parts[0] === projectId &&
    (parts[1] === "production" || parts[1] === "preview") &&
    parts[2]
  ) {
    return candidates.has(parts[2]);
  }

  // SSR module cache keys: v{version}:{projectId}:{contentSourceId}:...
  if (parts[0]?.startsWith("v") && parts[1] === projectId && parts[2]) {
    return candidates.has(parts[2]);
  }

  // Layout component cache keys: layout:{projectId}:{contentSourceId}:...
  if (parts[0] === "layout" && parts[1] === projectId && parts[2]) {
    return candidates.has(parts[2]);
  }

  // File/dir/stat/list cache keys: {prefix}:{sourceType}:{projectSlug}:{qualifier}:...
  if (parts[0] === "file" || parts[0] === "stat" || parts[0] === "dir" || parts[0] === "files") {
    const sourceType = parts[1];

    if ((sourceType === "branch" || sourceType === "release") && parts[3]) {
      return candidates.has(parts[3]);
    }

    if (sourceType === "env" && parts[3]) {
      return candidates.has(parts[3]) || candidates.has(parts[4] ?? "");
    }
  }

  return false;
}

export const cacheRegistry = new CacheRegistry();

export function registerMapCache(name: string, map: Map<string, unknown>): void {
  cacheRegistry.register(new MapCacheStore(name, map));
}

export function registerLRUCache(name: string, cache: LRULike): void {
  cacheRegistry.register(new LRUCacheStore(name, cache));
}
