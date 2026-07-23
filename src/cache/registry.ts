import { rendererLogger } from "#veryfront/utils";
import { getRedisClient, isRedisConfigured } from "#veryfront/utils/redis-client.ts";
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  buildRedisCacheScanPattern,
  getOwnedRedisCacheNamespaceDescriptors,
  type RedisCacheEnvironment,
  type RedisCacheNamespaceDescriptor,
  type RedisCacheProjectIdentity,
  stripOwnedRedisCacheKeyPrefix,
  validateRedisCacheProjectIdentity,
} from "./backends/redis-keyspace.ts";
import { encodeCacheSourceIdentity } from "./keys/source-identity.ts";

const logger = rendererLogger.component("cache-registry");

const DEFAULT_REDIS_SCAN_LIMIT = 1_000;
const REDIS_SCAN_BATCH_COUNT = 100;
const REDIS_DELETE_BATCH_SIZE = 1_000;
const MAX_REDIS_SCAN_ITERATIONS = 10_000;
const MAX_REDIS_SCANNED_KEYS = 100_000;
const MAX_REGISTERED_CACHE_STORES = 1_000;
const MAX_CACHE_STORE_NAME_CODE_UNITS = 256;

function matchesRedisProjectIdentity(
  descriptor: RedisCacheNamespaceDescriptor,
  descriptors: readonly RedisCacheNamespaceDescriptor[],
  key: string,
  identity: RedisCacheProjectIdentity,
  environment?: RedisCacheEnvironment,
): boolean {
  if (!descriptor.matchProjectOwnership || !key.startsWith(descriptor.prefix)) return false;

  // A key belongs to the longest registered namespace. Without this guard, an
  // opaque custom namespace nested below a built-in one (for example
  // `vf:render:private:`) could be reinterpreted using the parent render schema
  // and deleted as project data. Descriptors are sorted longest-first.
  if (descriptors.find((candidate) => key.startsWith(candidate.prefix)) !== descriptor) {
    return false;
  }

  const ownership = descriptor.matchProjectOwnership(key.slice(descriptor.prefix.length));
  if (!ownership) return false;

  const projectMatches =
    (identity.projectId !== undefined && ownership.projectId === identity.projectId) ||
    (identity.projectSlug !== undefined && ownership.projectSlug === identity.projectSlug);
  if (!projectMatches) return false;
  return environment === undefined || ownership.environment === environment;
}

function redisProjectSpanAttributes(
  identity: RedisCacheProjectIdentity,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (identity.projectId !== undefined) attributes["cache.project_id"] = identity.projectId;
  if (identity.projectSlug !== undefined) attributes["cache.project_slug"] = identity.projectSlug;
  return attributes;
}

function normalizeRedisProjectIdentity(
  identity: RedisCacheProjectIdentity | string,
): RedisCacheProjectIdentity {
  // Preserve the original public API without reintroducing ID/slug ambiguity:
  // a legacy string has always represented the project ID, never the slug.
  return validateRedisCacheProjectIdentity(
    typeof identity === "string" ? { projectId: identity } : identity,
  );
}

export interface CacheRegistryRedisClient {
  scan(
    cursor: number,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: number | string; keys: string[] }>;
  del(key: string | string[]): Promise<number>;
}

export interface CacheRegistryRedisProvider {
  isConfigured(): boolean;
  getClient(): Promise<CacheRegistryRedisClient>;
}

function parseRedisCursor(cursor: number | string): number {
  const parsed = typeof cursor === "number" ? cursor : Number(cursor);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError("Redis returned an invalid scan cursor");
  }
  return parsed;
}

const defaultRedisProvider: CacheRegistryRedisProvider = {
  isConfigured: isRedisConfigured,
  getClient: getRedisClient,
};

export interface CacheStore {
  readonly name: string;
  readonly projectOwnership?: CacheStoreProjectOwnership;
  get(key: string): unknown;
  keys(): Iterable<string>;
  size(): number;
  deleteWhere?(predicate: (key: string) => boolean): number;
}

/**
 * Project invalidation is opt-in for local stores. A registry entry without an
 * ownership descriptor remains observable for diagnostics, but opaque keys are
 * never reinterpreted and deleted merely because one segment resembles a
 * project identifier.
 */
export interface CacheStoreProjectOwnership {
  isKeyForProject(key: string, projectId: string): boolean;
  isKeyForProjectEnvironment(
    key: string,
    projectId: string,
    environment: "production" | "preview",
  ): boolean;
  isKeyForContentSource(key: string, projectId: string, contentSourceId: string): boolean;
}

function deleteWhereFromKeys(
  keys: Iterable<string>,
  deleteKey: (key: string) => boolean,
  predicate: (key: string) => boolean,
): number {
  let deleted = 0;
  for (const key of keys) {
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
    private readonly map: CacheStatsSource,
    readonly projectOwnership?: CacheStoreProjectOwnership,
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

/**
 * Narrow view of a key/value store sufficient for cache stats + inspection.
 * Both native `Map` and the LRU cache wrapper structurally satisfy this, so
 * callers can register lightweight wrappers without unsound `Map` casts.
 */
export interface CacheStatsSource {
  get(key: string): unknown;
  keys(): Iterable<string>;
  readonly size: number;
  delete(key: string): boolean;
}

export class LRUCacheStore implements CacheStore {
  readonly name: string;

  constructor(
    name: string,
    private readonly cache: LRULike,
    readonly projectOwnership?: CacheStoreProjectOwnership,
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

export class CacheRegistry {
  private stores = new Map<string, CacheStore>();

  constructor(private readonly redisProvider: CacheRegistryRedisProvider = defaultRedisProvider) {}

  register(store: CacheStore): () => boolean {
    const name = store.name;
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > MAX_CACHE_STORE_NAME_CODE_UNITS ||
      name.trim() !== name ||
      /\p{Cc}/u.test(name)
    ) {
      throw new TypeError(
        "Cache store name must be a trimmed 1-256 character string without control characters",
      );
    }
    if (!this.stores.has(name) && this.stores.size >= MAX_REGISTERED_CACHE_STORES) {
      throw new RangeError(
        `Cache registry may retain at most ${MAX_REGISTERED_CACHE_STORES} stores`,
      );
    }
    if (this.stores.has(name)) {
      logger.warn(`Replacing existing store: ${name}`);
    }
    this.stores.set(name, store);
    logger.debug(`Registered store: ${name}`);

    return () => {
      if (this.stores.get(name) !== store) return false;
      return this.stores.delete(name);
    };
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
      const matchingKeys = [...store.keys()].filter((key) =>
        store.projectOwnership?.isKeyForProject(key, projectId) ?? false
      );
      if (matchingKeys.length) result.set(name, matchingKeys);
    }

    return result;
  }

  countKeysForProject(projectId: string): number {
    let count = 0;
    for (const store of this.stores.values()) {
      for (const key of store.keys()) {
        if (store.projectOwnership?.isKeyForProject(key, projectId)) count++;
      }
    }
    return count;
  }

  deleteKeysForProject(projectId: string): number {
    let totalDeleted = 0;

    for (const store of this.stores.values()) {
      totalDeleted += store.deleteWhere?.((key) =>
        store.projectOwnership?.isKeyForProject(key, projectId) ?? false
      ) ?? 0;
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
        store.projectOwnership?.isKeyForProjectEnvironment(key, projectId, environment) ?? false
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
        store.projectOwnership?.isKeyForContentSource(key, projectId, contentSourceId) ?? false
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
      const sampleKeys: string[] = [];
      for (const key of store.keys()) {
        sampleKeys.push(key);
        if (sampleKeys.length === 5) break;
      }
      stats.push({ name, size: store.size(), sampleKeys });
    }

    return stats;
  }

  clear(): void {
    this.stores.clear();
  }

  scanRedisKeys(
    pattern: string,
    limit = DEFAULT_REDIS_SCAN_LIMIT,
    predicate: (key: string) => boolean = () => true,
  ): Promise<string[]> {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      return Promise.reject(new RangeError("Redis scan limit must be a non-negative integer"));
    }
    if (limit === 0 || !this.redisProvider.isConfigured()) return Promise.resolve([]);

    return withSpan(
      SpanNames.CACHE_REGISTRY_SCAN_REDIS,
      async (span?: Span) => {
        try {
          const client = await this.redisProvider.getClient();
          const keys = new Set<string>();
          let cursor = 0;
          let iterations = 0;
          let scannedKeys = 0;
          const seenCursors = new Set<number>();

          do {
            if (iterations++ >= MAX_REDIS_SCAN_ITERATIONS) {
              throw new RangeError("Redis scan exceeded the iteration limit");
            }
            if (seenCursors.has(cursor)) {
              throw new Error("Redis scan repeated a cursor before completion");
            }
            seenCursors.add(cursor);
            const result = await client.scan(cursor, {
              MATCH: pattern,
              COUNT: REDIS_SCAN_BATCH_COUNT,
            });
            cursor = parseRedisCursor(result.cursor);
            if (
              !Array.isArray(result.keys) || !result.keys.every((key) => typeof key === "string")
            ) {
              throw new TypeError("Redis returned invalid scan keys");
            }
            scannedKeys += result.keys.length;
            if (scannedKeys > MAX_REDIS_SCANNED_KEYS) {
              throw new RangeError("Redis scan exceeded the key traversal limit");
            }
            for (const key of result.keys) {
              if (predicate(key)) keys.add(key);
              if (keys.size === limit) break;
            }
          } while (cursor !== 0 && keys.size < limit);

          span?.setAttribute("cache.redis.keys_found", keys.size);
          return [...keys];
        } catch (error) {
          logger.warn("Redis scan failed", {
            patternLength: pattern.length,
            errorName: error instanceof Error ? error.name : typeof error,
          });
          span?.setAttribute("cache.redis.error", true);
          return [];
        }
      },
      { "cache.redis.pattern_length": pattern.length, "cache.redis.limit": limit },
    );
  }

  /** @deprecated Pass an identity object when the project slug is available. */
  getRedisKeysForProject(projectId: string): Promise<Map<string, string[]>>;
  getRedisKeysForProject(
    projectIdentity: RedisCacheProjectIdentity,
  ): Promise<Map<string, string[]>>;
  async getRedisKeysForProject(
    projectIdentity: RedisCacheProjectIdentity | string,
  ): Promise<Map<string, string[]>> {
    const identity = normalizeRedisProjectIdentity(projectIdentity);
    return await withSpan(
      SpanNames.CACHE_REGISTRY_GET_REDIS_KEYS,
      async (span?: Span) => {
        const result = new Map<string, string[]>();
        const descriptors = getOwnedRedisCacheNamespaceDescriptors();

        let totalKeys = 0;
        const listedKeys = new Set<string>();
        for (const descriptor of descriptors) {
          if (!descriptor.matchProjectOwnership) continue;
          const keys = await this.scanRedisKeys(
            buildRedisCacheScanPattern(descriptor.prefix),
            DEFAULT_REDIS_SCAN_LIMIT,
            (key) => {
              if (
                listedKeys.has(key) ||
                !matchesRedisProjectIdentity(descriptor, descriptors, key, identity)
              ) return false;
              listedKeys.add(key);
              return true;
            },
          );
          if (!keys.length) continue;

          result.set(descriptor.prefix.slice(0, -1), keys);
          totalKeys += keys.length;
        }

        span?.setAttribute("cache.redis.total_keys", totalKeys);
        span?.setAttribute("cache.redis.prefix_count", result.size);
        return result;
      },
      redisProjectSpanAttributes(identity),
    );
  }

  getAllKeysForProjectAsync(
    projectId: string,
    includeRedis = false,
    projectSlug?: string,
  ): Promise<{ memory: Map<string, string[]>; redis: Map<string, string[]> }> {
    return withSpan(
      SpanNames.CACHE_KEYS_GET_ALL_ASYNC,
      async (span?: Span) => {
        const memory = this.getKeysForProject(projectId);

        span?.setAttribute("cache.include_redis", includeRedis);
        if (!includeRedis) return { memory, redis: new Map() };

        const redis = await this.getRedisKeysForProject({ projectId, projectSlug });
        return { memory, redis };
      },
      { "cache.project_id": projectId },
    );
  }

  /** @deprecated Pass an identity object when the project slug is available. */
  deleteRedisKeysForProject(projectId: string): Promise<number>;
  deleteRedisKeysForProject(projectIdentity: RedisCacheProjectIdentity): Promise<number>;
  async deleteRedisKeysForProject(
    projectIdentity: RedisCacheProjectIdentity | string,
  ): Promise<number> {
    const identity = normalizeRedisProjectIdentity(projectIdentity);
    if (!this.redisProvider.isConfigured()) return Promise.resolve(0);

    return await withSpan(
      SpanNames.CACHE_REGISTRY_DELETE_REDIS_KEYS,
      async (span?: Span) => {
        try {
          const client = await this.redisProvider.getClient();
          const deleted = await this.deleteRedisKeysMatching(
            client,
            identity,
          );

          span?.setAttribute("cache.redis.deleted", deleted);
          return deleted;
        } catch (error) {
          logger.warn("Redis delete failed", {
            ...identity,
            errorName: error instanceof Error ? error.name : typeof error,
          });
          span?.setAttribute("cache.redis.error", true);
          throw error;
        }
      },
      redisProjectSpanAttributes(identity),
    );
  }

  deleteAllKeysForProjectAsync(projectId: string, projectSlug?: string): Promise<{
    memoryDeleted: number;
    redisDeleted: number;
  }> {
    return withSpan(
      SpanNames.CACHE_KEYS_DELETE_ALL_ASYNC,
      async (span?: Span) => {
        const memoryDeleted = this.deleteKeysForProject(projectId);
        const redisDeleted = await this.deleteRedisKeysForProject({ projectId, projectSlug });

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
    projectSlug?: string,
  ): Promise<{ memoryDeleted: number; redisDeleted: number }> {
    return withSpan(
      SpanNames.CACHE_KEYS_DELETE_ALL_ASYNC,
      async (span?: Span) => {
        const memoryDeleted = this.deleteKeysForProjectEnvironment(projectId, environment);
        const redisDeleted = await this.deleteRedisKeysForProjectEnvironment(
          { projectId, projectSlug },
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

  async deleteRedisKeysForProjectEnvironment(
    projectIdentity: RedisCacheProjectIdentity,
    environment: "production" | "preview",
  ): Promise<number> {
    const identity = validateRedisCacheProjectIdentity(projectIdentity);
    if (!this.redisProvider.isConfigured()) return Promise.resolve(0);

    return await withSpan(
      SpanNames.CACHE_REGISTRY_DELETE_REDIS_KEYS,
      async (span?: Span) => {
        try {
          const client = await this.redisProvider.getClient();
          const deleted = await this.deleteRedisKeysMatching(
            client,
            identity,
            environment,
          );

          span?.setAttribute("cache.redis.deleted", deleted);
          span?.setAttribute("cache.environment", environment);
          return deleted;
        } catch (error) {
          logger.warn("Redis delete for environment failed", {
            ...identity,
            environment,
            errorName: error instanceof Error ? error.name : typeof error,
          });
          span?.setAttribute("cache.redis.error", true);
          throw error;
        }
      },
      { ...redisProjectSpanAttributes(identity), "cache.environment": environment },
    );
  }

  private async deleteRedisKeysMatching(
    client: CacheRegistryRedisClient,
    identity: RedisCacheProjectIdentity,
    environment?: RedisCacheEnvironment,
  ): Promise<number> {
    const matchingKeys = new Set<string>();
    const descriptors = getOwnedRedisCacheNamespaceDescriptors();
    let totalScanIterations = 0;
    let totalScannedKeys = 0;

    for (const descriptor of descriptors) {
      if (!descriptor.matchProjectOwnership) continue;
      let cursor = 0;
      const seenCursors = new Set<number>();
      do {
        if (totalScanIterations++ >= MAX_REDIS_SCAN_ITERATIONS) {
          throw new RangeError("Redis scan exceeded the iteration limit");
        }
        if (seenCursors.has(cursor)) {
          throw new Error("Redis scan repeated a cursor before completion");
        }
        seenCursors.add(cursor);
        const result = await client.scan(cursor, {
          MATCH: buildRedisCacheScanPattern(descriptor.prefix),
          COUNT: REDIS_SCAN_BATCH_COUNT,
        });
        cursor = parseRedisCursor(result.cursor);
        if (!Array.isArray(result.keys) || !result.keys.every((key) => typeof key === "string")) {
          throw new TypeError("Redis returned invalid scan keys");
        }
        totalScannedKeys += result.keys.length;
        if (totalScannedKeys > MAX_REDIS_SCANNED_KEYS) {
          throw new RangeError("Redis scan exceeded the key traversal limit");
        }

        for (const key of result.keys) {
          if (
            matchingKeys.has(key) ||
            !matchesRedisProjectIdentity(
              descriptor,
              descriptors,
              key,
              identity,
              environment,
            )
          ) continue;
          matchingKeys.add(key);
        }
      } while (cursor !== 0);
    }

    // Complete every SCAN traversal before mutating Redis. Deleting pages while
    // a cursor is active weakens SCAN's iteration guarantees and can leave
    // undiscovered project keys behind after a nominally successful purge.
    const keys = [...matchingKeys];
    let deleted = 0;
    for (let index = 0; index < keys.length; index += REDIS_DELETE_BATCH_SIZE) {
      const batch = keys.slice(index, index + REDIS_DELETE_BATCH_SIZE);
      const count = await client.del(batch);
      if (!Number.isSafeInteger(count) || count < 0 || count > batch.length) {
        throw new TypeError("Redis returned an invalid DEL count");
      }
      deleted += count;
    }

    return deleted;
  }
}

export function isKeyForProject(key: string, projectId: string): boolean {
  if (projectId.trim().length === 0) return false;
  const normalizedKey = stripRedisPrefix(key);
  const parts = normalizedKey.split(":");
  if (parts.length < 2) return false;

  // Versioned cache keys: v{version}:{projectId}:...
  if (parts[0]?.startsWith("v") && parts[1] === projectId) return true;

  // Render/module cache keys where projectId is first segment and next is env/content source
  let decodedFirstSegment: string | undefined;
  try {
    decodedFirstSegment = parts[0] ? decodeURIComponent(parts[0]) : undefined;
  } catch {
    decodedFirstSegment = undefined;
  }
  if (decodedFirstSegment === projectId) {
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

/**
 * Descriptor for stores whose keys are produced by the structured cache-key
 * builders recognized below. Registration must opt in explicitly.
 */
export const structuredCacheStoreProjectOwnership: CacheStoreProjectOwnership = Object.freeze({
  isKeyForProject,
  isKeyForProjectEnvironment,
  isKeyForContentSource,
});

export function extractProjectIdFromKey(key: string): string | null {
  const parts = key.split(":");
  return parts[1] ?? null;
}

function stripRedisPrefix(key: string): string {
  return stripOwnedRedisCacheKeyPrefix(key);
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
    if (sourceType === "env") return "production";
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
  const encodedContentSourceId = encodeCacheSourceIdentity({
    type: "branch",
    branch: contentSourceId,
  }).qualifier;

  const candidates = new Set<string>([
    contentSourceId,
    encodedContentSourceId,
    `preview-${contentSourceId}`,
    `preview-${encodedContentSourceId}`,
    `release-${contentSourceId}`,
    `release-${encodedContentSourceId}`,
    `production-${contentSourceId}`,
    `production-${encodedContentSourceId}`,
    `prod-${contentSourceId}`,
    `prod-${encodedContentSourceId}`,
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

export function registerMapCache(
  name: string,
  map: CacheStatsSource,
  projectOwnership?: CacheStoreProjectOwnership,
): () => boolean {
  return cacheRegistry.register(new MapCacheStore(name, map, projectOwnership));
}

export function registerLRUCache(
  name: string,
  cache: LRULike,
  projectOwnership?: CacheStoreProjectOwnership,
): () => boolean {
  return cacheRegistry.register(new LRUCacheStore(name, cache, projectOwnership));
}
