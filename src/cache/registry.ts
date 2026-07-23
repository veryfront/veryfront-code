import { rendererLogger } from "#veryfront/utils";
import {
  getRedisClient,
  isRedisConfigured,
  type RedisClient,
} from "#veryfront/utils/redis-client.ts";
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  CACHE_ERROR,
  INVALID_ARGUMENT,
  SERVICE_OVERLOADED,
  VeryfrontError,
} from "#veryfront/errors";
import { encodeCacheIdentitySegment } from "./keys/source-identity.ts";
import { containsUnsafeCacheStringCharacter } from "./validation.ts";

const logger = rendererLogger.component("cache-registry");

const DEFAULT_REDIS_SCAN_LIMIT = 1_000;
const REDIS_SCAN_BATCH_COUNT = 100;
const MAX_REDIS_SCAN_LIMIT = 1_000_000;
const MAX_REDIS_SCAN_ITERATIONS = 100_000;
const MAX_REDIS_SCAN_PAGE_KEYS = 10_000;
const MAX_REDIS_SCAN_VISITED_KEYS = 1_000_000;
const REDIS_DELETE_BATCH_SIZE = 1_000;
const MAX_REGISTRY_STORE_NAME_LENGTH = 128;
const MAX_REGISTRY_STORES = 1_024;
const MAX_REGISTRY_KEY_LENGTH = 4096;
const MAX_REGISTRY_KEYS_PER_STORE = 100_000;
const MAX_REGISTRY_AGGREGATE_KEYS = 100_000;
const REDIS_KEY_PREFIXES = [
  "veryfront:ssr-module:",
  "veryfront:file-cache:",
  "veryfront:transform:",
] as const;

function invalidArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function cacheOperationFailed(operation: string): never {
  throw CACHE_ERROR.create({ detail: `Cache registry ${operation} failed` });
}

function assertStoreName(name: unknown): asserts name is string {
  if (
    typeof name !== "string" || name.length === 0 ||
    name.length > MAX_REGISTRY_STORE_NAME_LENGTH || containsUnsafeCacheStringCharacter(name)
  ) {
    invalidArgument(
      "Cache store name must be a bounded string without control characters or unpaired UTF-16 surrogates",
    );
  }
}

function assertRegistryKey(key: unknown): asserts key is string {
  if (
    typeof key !== "string" || key.length === 0 || key.length > MAX_REGISTRY_KEY_LENGTH ||
    containsUnsafeCacheStringCharacter(key)
  ) {
    invalidArgument(
      "Cache registry key must be a bounded string without control characters or unpaired UTF-16 surrogates",
    );
  }
}

function encodeProjectIdentity(projectId: unknown): string {
  if (typeof projectId !== "string") invalidArgument("Project identity must be a string");
  try {
    return encodeCacheIdentitySegment(projectId, "projectId");
  } catch {
    invalidArgument("Project identity is invalid");
  }
}

interface RegistryKeyBudget {
  count: number;
}

function collectKeysBounded(
  keys: Iterable<string>,
  limit = MAX_REGISTRY_KEYS_PER_STORE,
  aggregateBudget?: RegistryKeyBudget,
): string[] {
  const result: string[] = [];
  for (const key of keys) {
    assertRegistryKey(key);
    if (result.length >= limit) {
      throw SERVICE_OVERLOADED.create({
        message: "Cache registry store exceeds the supported key count",
      });
    }
    if (
      aggregateBudget && aggregateBudget.count >= MAX_REGISTRY_AGGREGATE_KEYS
    ) {
      throw SERVICE_OVERLOADED.create({
        message: "Cache registry snapshot exceeds the supported aggregate key count",
      });
    }
    result.push(key);
    if (aggregateBudget) aggregateBudget.count++;
  }
  return result;
}

function takeKeys(keys: Iterable<string>, limit: number): string[] {
  const result: string[] = [];
  for (const key of keys) {
    assertRegistryKey(key);
    result.push(key);
    if (result.length >= limit) break;
  }
  return result;
}

function assertRedisPattern(pattern: unknown): asserts pattern is string {
  if (
    typeof pattern !== "string" || pattern.length === 0 ||
    pattern.length > MAX_REGISTRY_KEY_LENGTH || containsUnsafeCacheStringCharacter(pattern)
  ) {
    invalidArgument(
      "Redis cache pattern must be a bounded string without control characters or unpaired UTF-16 surrogates",
    );
  }
}

function normalizeRedisScanLimit(limit: unknown): number {
  if (
    !Number.isSafeInteger(limit) || (limit as number) < 1 ||
    (limit as number) > MAX_REDIS_SCAN_LIMIT
  ) {
    invalidArgument("Redis scan limit must be a positive safe integer within the supported range");
  }
  return limit as number;
}

function normalizeRedisCursor(cursor: unknown): number {
  const normalized = typeof cursor === "string" && /^(0|[1-9]\d*)$/.test(cursor)
    ? Number(cursor)
    : cursor;
  if (typeof normalized !== "number" || !Number.isSafeInteger(normalized) || normalized < 0) {
    cacheOperationFailed("scan");
  }
  return normalized;
}

async function walkRedisKeys(
  client: Pick<RedisClient, "scan">,
  pattern: string,
  visit: (keys: readonly string[]) => boolean | Promise<boolean>,
): Promise<void> {
  assertRedisPattern(pattern);
  let cursor = 0;
  let iterations = 0;
  let visitedKeys = 0;
  const seenCursors = new Set<number>();

  do {
    if (++iterations > MAX_REDIS_SCAN_ITERATIONS) {
      throw SERVICE_OVERLOADED.create({ message: "Redis cache scan iteration limit exceeded" });
    }
    const result = await client.scan(cursor, {
      MATCH: pattern,
      COUNT: REDIS_SCAN_BATCH_COUNT,
    });
    if (typeof result !== "object" || result === null || !Array.isArray(result.keys)) {
      cacheOperationFailed("scan");
    }
    if (result.keys.length > MAX_REDIS_SCAN_PAGE_KEYS) {
      throw SERVICE_OVERLOADED.create({
        message: "Redis cache scan page exceeds the supported size",
      });
    }
    visitedKeys += result.keys.length;
    if (visitedKeys > MAX_REDIS_SCAN_VISITED_KEYS) {
      throw SERVICE_OVERLOADED.create({
        message: "Redis cache scan exceeds the supported visited-key count",
      });
    }
    for (const key of result.keys) assertRegistryKey(key);

    const nextCursor = normalizeRedisCursor(result.cursor);
    if (nextCursor !== 0) {
      if (seenCursors.has(nextCursor)) cacheOperationFailed("scan");
      seenCursors.add(nextCursor);
    }
    if (await visit(result.keys)) return;
    cursor = nextCursor;
  } while (cursor !== 0);
}

async function scanRedisKeysWithClient(
  client: Pick<RedisClient, "scan">,
  pattern: string,
  limit: number,
): Promise<string[]> {
  const normalizedLimit = normalizeRedisScanLimit(limit);
  const keys: string[] = [];
  const seenKeys = new Set<string>();

  await walkRedisKeys(client, pattern, (page) => {
    for (const key of page) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      keys.push(key);
      if (keys.length === normalizedLimit) return true;
    }
    return false;
  });
  return keys;
}

async function deleteRedisKeysWithClient(
  client: Pick<RedisClient, "scan" | "del">,
  pattern: string,
  predicate: (key: string) => boolean,
): Promise<number> {
  let deleted = 0;
  await walkRedisKeys(client, pattern, async (page) => {
    const matching = page.filter(predicate);
    for (let offset = 0; offset < matching.length; offset += REDIS_DELETE_BATCH_SIZE) {
      const batch = matching.slice(offset, offset + REDIS_DELETE_BATCH_SIZE);
      const count = await client.del(batch);
      if (!Number.isSafeInteger(count) || count < 0 || count > batch.length) {
        cacheOperationFailed("delete");
      }
      deleted += count;
    }
    return false;
  });
  return deleted;
}

export const __cacheRegistryRedisHelpersForTests = Object.freeze({
  scanRedisKeysWithClient,
  deleteRedisKeysWithClient,
});

export interface CacheStore {
  readonly name: string;
  get(key: string): unknown;
  keys(): Iterable<string>;
  size(): number;
  deleteWhere?(predicate: (key: string) => boolean): number;
}

function readStoreMember(store: object, key: keyof CacheStore): unknown {
  try {
    return Reflect.get(store, key);
  } catch {
    invalidArgument("Cache store contract must be readable");
  }
}

function snapshotCacheStore(value: unknown): CacheStore {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidArgument("Cache store must be an object");
  }
  const store = value as object;
  const name = readStoreMember(store, "name");
  assertStoreName(name);
  const get = readStoreMember(store, "get");
  const keys = readStoreMember(store, "keys");
  const size = readStoreMember(store, "size");
  const deleteWhere = readStoreMember(store, "deleteWhere");
  if (
    typeof get !== "function" || typeof keys !== "function" || typeof size !== "function" ||
    (deleteWhere !== undefined && typeof deleteWhere !== "function")
  ) {
    invalidArgument("Cache store does not implement the required contract");
  }

  const snapshot: CacheStore = {
    name,
    get(key: string): unknown {
      assertRegistryKey(key);
      return Reflect.apply(get, store, [key]);
    },
    keys(): Iterable<string> {
      const iterable: unknown = Reflect.apply(keys, store, []);
      let iterator: unknown;
      try {
        iterator = iterable === null || iterable === undefined
          ? undefined
          : Reflect.get(Object(iterable), Symbol.iterator);
      } catch {
        invalidArgument("Cache store keys must be iterable");
      }
      if (typeof iterator !== "function") {
        invalidArgument("Cache store keys must be iterable");
      }
      return iterable as Iterable<string>;
    },
    size(): number {
      const result: unknown = Reflect.apply(size, store, []);
      if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) {
        invalidArgument("Cache store size must be a non-negative safe integer");
      }
      return result;
    },
    deleteWhere: deleteWhere === undefined
      ? undefined
      : (predicate: (key: string) => boolean): number => {
        if (typeof predicate !== "function") {
          invalidArgument("Cache store delete predicate must be a function");
        }
        const result: unknown = Reflect.apply(deleteWhere, store, [predicate]);
        if (
          typeof result !== "number" || !Number.isSafeInteger(result) || result < 0 ||
          result > MAX_REGISTRY_KEYS_PER_STORE
        ) {
          invalidArgument("Cache store delete count is invalid");
        }
        return result;
      },
  };
  return Object.freeze(snapshot);
}

function deleteWhereFromKeys(
  keys: Iterable<string>,
  deleteKey: (key: string) => boolean,
  predicate: (key: string) => boolean,
): number {
  let deleted = 0;
  for (const key of collectKeysBounded(keys)) {
    if (!predicate(key)) continue;
    if (deleteKey(key)) deleted++;
  }
  return deleted;
}

export class MapCacheStore implements CacheStore {
  readonly name: string;

  constructor(
    name: string,
    private readonly map: CacheStatsSource,
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

/**
 * Narrow view of a key/value store sufficient for cache stats + inspection.
 * Both native `Map` and the LRU cache wrapper structurally satisfy this, so
 * callers can register lightweight wrappers without unsound `Map` casts.
 */
export interface CacheStatsSource {
  /** Read a cached value for diagnostics. */
  get(key: string): unknown;
  /** Iterate the source's cache keys. */
  keys(): Iterable<string>;
  /** Current entry count. */
  readonly size: number;
  /** Delete one cache key. */
  delete(key: string): boolean;
}

export class LRUCacheStore implements CacheStore {
  readonly name: string;

  constructor(
    name: string,
    private readonly cache: CacheStatsSource,
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
    const snapshot = snapshotCacheStore(store);
    if (!this.stores.has(snapshot.name) && this.stores.size >= MAX_REGISTRY_STORES) {
      throw SERVICE_OVERLOADED.create({
        message: "Cache registry exceeds the supported store count",
      });
    }
    if (this.stores.has(snapshot.name)) {
      logger.warn("Replacing existing cache store");
    }
    this.stores.set(snapshot.name, snapshot);
    logger.debug("Registered cache store");
  }

  unregister(name: string): boolean {
    assertStoreName(name);
    return this.stores.delete(name);
  }

  get(name: string): CacheStore | undefined {
    assertStoreName(name);
    return this.stores.get(name);
  }

  getStoreNames(): string[] {
    return [...this.stores.keys()];
  }

  getAllKeys(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    const budget = { count: 0 };
    for (const [name, store] of this.stores) {
      result.set(name, collectKeysBounded(store.keys(), MAX_REGISTRY_KEYS_PER_STORE, budget));
    }
    return result;
  }

  getKeysForProject(projectId: string): Map<string, string[]> {
    encodeProjectIdentity(projectId);
    const result = new Map<string, string[]>();
    const budget = { count: 0 };

    for (const [name, store] of this.stores) {
      const matchingKeys = collectKeysBounded(
        store.keys(),
        MAX_REGISTRY_KEYS_PER_STORE,
        budget,
      ).filter((key) => isKeyForProject(key, projectId));
      if (matchingKeys.length) result.set(name, matchingKeys);
    }

    return result;
  }

  countKeysForProject(projectId: string): number {
    encodeProjectIdentity(projectId);
    let count = 0;
    const budget = { count: 0 };
    for (const store of this.stores.values()) {
      for (
        const key of collectKeysBounded(
          store.keys(),
          MAX_REGISTRY_KEYS_PER_STORE,
          budget,
        )
      ) {
        if (isKeyForProject(key, projectId)) count++;
      }
    }
    return count;
  }

  deleteKeysForProject(projectId: string): number {
    encodeProjectIdentity(projectId);
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
    encodeProjectIdentity(projectId);
    let totalDeleted = 0;

    for (const store of this.stores.values()) {
      totalDeleted += store.deleteWhere?.((key) =>
        isKeyForProjectEnvironment(key, projectId, environment)
      ) ?? 0;
    }

    logger.debug("Deleted keys for project environment", {
      environment,
      deleted: totalDeleted,
    });

    return totalDeleted;
  }

  /** Delete cache entries for a specific content source (branch or release) */
  deleteKeysForContentSource(projectId: string, contentSourceId: string): number {
    encodeProjectIdentity(projectId);
    encodeCacheIdentitySegment(contentSourceId, "contentSourceId");
    let totalDeleted = 0;

    for (const store of this.stores.values()) {
      totalDeleted += store.deleteWhere?.((key) =>
        isKeyForProject(key, projectId) && isKeyForContentSource(key, projectId, contentSourceId)
      ) ?? 0;
    }

    logger.debug("Deleted keys for content source", {
      deleted: totalDeleted,
    });

    return totalDeleted;
  }

  getStats(): Array<{ name: string; size: number; sampleKeys: string[] }> {
    const stats: Array<{ name: string; size: number; sampleKeys: string[] }> = [];

    for (const [name, store] of this.stores) {
      stats.push({ name, size: store.size(), sampleKeys: takeKeys(store.keys(), 5) });
    }

    return stats;
  }

  clear(): void {
    this.stores.clear();
  }

  scanRedisKeys(pattern: string, limit = DEFAULT_REDIS_SCAN_LIMIT): Promise<string[]> {
    assertRedisPattern(pattern);
    const normalizedLimit = normalizeRedisScanLimit(limit);
    if (!isRedisConfigured()) return Promise.resolve([]);

    return withSpan(
      SpanNames.CACHE_REGISTRY_SCAN_REDIS,
      async (span?: Span) => {
        try {
          const client = await getRedisClient();
          const resultKeys = await scanRedisKeysWithClient(client, pattern, normalizedLimit);
          span?.setAttribute("cache.redis.keys_found", resultKeys.length);
          return resultKeys;
        } catch (error) {
          logger.warn("Redis cache scan failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          span?.setAttribute("cache.redis.error", true);
          if (error instanceof VeryfrontError) throw error;
          cacheOperationFailed("scan");
        }
      },
      { "cache.redis.limit": normalizedLimit },
    );
  }

  getRedisKeysForProject(projectId: string): Promise<Map<string, string[]>> {
    encodeProjectIdentity(projectId);
    return withSpan(
      SpanNames.CACHE_REGISTRY_GET_REDIS_KEYS,
      async (span?: Span) => {
        const result = new Map<string, string[]>();

        let totalKeys = 0;
        for (const prefix of REDIS_KEY_PREFIXES) {
          const keys = await this.scanRedisKeys(`${prefix}*`, MAX_REDIS_SCAN_LIMIT);
          const matchingKeys = keys.filter((key) => isKeyForProject(key, projectId));
          if (!matchingKeys.length) continue;

          if (totalKeys + matchingKeys.length > MAX_REDIS_SCAN_LIMIT) {
            throw SERVICE_OVERLOADED.create({
              message: "Redis cache project snapshot exceeds the supported key count",
            });
          }

          result.set(prefix.replace(/:$/, ""), matchingKeys);
          totalKeys += matchingKeys.length;
        }

        span?.setAttribute("cache.redis.total_keys", totalKeys);
        span?.setAttribute("cache.redis.prefix_count", result.size);
        return result;
      },
      undefined,
    );
  }

  getAllKeysForProjectAsync(
    projectId: string,
    includeRedis = false,
  ): Promise<{ memory: Map<string, string[]>; redis: Map<string, string[]> }> {
    encodeProjectIdentity(projectId);
    return withSpan(
      SpanNames.CACHE_KEYS_GET_ALL_ASYNC,
      async (span?: Span) => {
        const memory = this.getKeysForProject(projectId);

        span?.setAttribute("cache.include_redis", includeRedis);
        if (!includeRedis) return { memory, redis: new Map() };

        const redis = await this.getRedisKeysForProject(projectId);
        return { memory, redis };
      },
      undefined,
    );
  }

  deleteRedisKeysForProject(projectId: string): Promise<number> {
    encodeProjectIdentity(projectId);
    if (!isRedisConfigured()) return Promise.resolve(0);

    return withSpan(
      SpanNames.CACHE_REGISTRY_DELETE_REDIS_KEYS,
      async (span?: Span) => {
        try {
          const client = await getRedisClient();
          let deleted = 0;
          for (const prefix of REDIS_KEY_PREFIXES) {
            deleted += await deleteRedisKeysWithClient(
              client,
              `${prefix}*`,
              (key) => isKeyForProject(key, projectId),
            );
          }

          span?.setAttribute("cache.redis.deleted", deleted);
          return deleted;
        } catch (error) {
          logger.warn("Redis cache delete failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          span?.setAttribute("cache.redis.error", true);
          if (error instanceof VeryfrontError) throw error;
          cacheOperationFailed("delete");
        }
      },
      undefined,
    );
  }

  deleteAllKeysForProjectAsync(projectId: string): Promise<{
    memoryDeleted: number;
    redisDeleted: number;
  }> {
    encodeProjectIdentity(projectId);
    return withSpan(
      SpanNames.CACHE_KEYS_DELETE_ALL_ASYNC,
      async (span?: Span) => {
        const memoryDeleted = this.deleteKeysForProject(projectId);
        const redisDeleted = await this.deleteRedisKeysForProject(projectId);

        span?.setAttribute("cache.memory.deleted", memoryDeleted);
        span?.setAttribute("cache.redis.deleted", redisDeleted);
        return { memoryDeleted, redisDeleted };
      },
      undefined,
    );
  }

  /** Delete all cache entries for a specific project and environment (memory + Redis) */
  deleteAllKeysForProjectEnvironmentAsync(
    projectId: string,
    environment: "production" | "preview",
  ): Promise<{ memoryDeleted: number; redisDeleted: number }> {
    encodeProjectIdentity(projectId);
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
          environment,
          memoryDeleted,
          redisDeleted,
        });

        return { memoryDeleted, redisDeleted };
      },
      { "cache.environment": environment },
    );
  }

  private deleteRedisKeysForProjectEnvironment(
    projectId: string,
    environment: "production" | "preview",
  ): Promise<number> {
    encodeProjectIdentity(projectId);
    if (!isRedisConfigured()) return Promise.resolve(0);

    return withSpan(
      SpanNames.CACHE_REGISTRY_DELETE_REDIS_KEYS,
      async (span?: Span) => {
        try {
          const client = await getRedisClient();
          let deleted = 0;
          for (const prefix of REDIS_KEY_PREFIXES) {
            deleted += await deleteRedisKeysWithClient(
              client,
              `${prefix}*`,
              (key) => isKeyForProjectEnvironment(key, projectId, environment),
            );
          }

          span?.setAttribute("cache.redis.deleted", deleted);
          span?.setAttribute("cache.environment", environment);
          return deleted;
        } catch (error) {
          logger.warn("Redis delete for environment failed", {
            environment,
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          span?.setAttribute("cache.redis.error", true);
          if (error instanceof VeryfrontError) throw error;
          cacheOperationFailed("delete");
        }
      },
      { "cache.environment": environment },
    );
  }
}

export function isKeyForProject(key: string, projectId: string): boolean {
  let encodedProjectId: string;
  try {
    assertRegistryKey(key);
    encodedProjectId = encodeProjectIdentity(projectId);
  } catch {
    return false;
  }
  const normalizedKey = stripRedisPrefix(key);
  const parts = normalizedKey.split(":");
  if (parts.length < 2) return false;

  // Versioned cache keys: v{version}:{projectId}:...
  if (parts[0]?.startsWith("v") && parts[1] === encodedProjectId) return true;

  // Render/module cache keys where projectId is first segment and next is env/content source
  if (parts[0] === encodedProjectId) {
    if (parts[1] === "production" || parts[1] === "preview") return true;
    if (getEnvironmentFromContentSourceId(parts[1])) return true;
  }

  // Common prefixes where projectId is second segment (layout/component/proxy/etc.)
  if (parts[1] === encodedProjectId) return true;

  // File/dir/stat/list cache keys: {prefix}:{sourceType}:{projectSlug}:...
  if (parts.length > 2 && parts[2] === encodedProjectId) return true;

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

function stripRedisPrefix(key: string): string {
  for (const prefix of REDIS_KEY_PREFIXES) {
    if (key.startsWith(prefix)) return key.slice(prefix.length);
  }
  return key;
}

function getVersionedContentSourceSegment(
  normalizedKey: string,
  encodedProjectId: string,
): string | null {
  const versionEnd = normalizedKey.indexOf(":");
  if (versionEnd <= 0 || !normalizedKey.slice(0, versionEnd).startsWith("v")) return null;
  const projectEnd = normalizedKey.indexOf(":", versionEnd + 1);
  if (projectEnd === -1) return null;
  if (normalizedKey.slice(versionEnd + 1, projectEnd) !== encodedProjectId) return null;

  const identity = normalizedKey.slice(projectEnd + 1);
  if (!identity) return null;
  if (!identity.startsWith("[")) return identity.split(":", 1)[0] ?? null;

  try {
    const parsed: unknown = JSON.parse(identity);
    if (!Array.isArray(parsed) || typeof parsed[0] !== "string") return null;
    return encodeCacheIdentitySegment(parsed[0], "contentSourceId");
  } catch {
    return null;
  }
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
  const encodedProjectId = encodeProjectIdentity(projectId);

  // Render cache keys: {projectId}:{environment}:{releaseKey}:{version}:...
  if (
    parts[0] === encodedProjectId && (parts[1] === "production" || parts[1] === "preview")
  ) {
    return parts[1] as CacheEnvironment;
  }

  // SSR module cache keys: v{version}:{projectId}:{contentSourceId}:...
  if (parts[0]?.startsWith("v") && parts[1] === encodedProjectId) {
    return getEnvironmentFromContentSourceId(
      getVersionedContentSourceSegment(normalizedKey, encodedProjectId) ?? undefined,
    );
  }

  // Layout component cache keys: layout:{projectId}:{contentSourceId}:...
  if (parts[0] === "layout" && parts[1] === encodedProjectId) {
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
  const encodedProjectId = encodeProjectIdentity(projectId);
  const encodedContentSourceId = encodeCacheIdentitySegment(contentSourceId, "contentSourceId");

  const candidates = new Set<string>([
    encodedContentSourceId,
    encodeCacheIdentitySegment(`preview-${contentSourceId}`, "contentSourceId"),
    encodeCacheIdentitySegment(`release-${contentSourceId}`, "contentSourceId"),
    encodeCacheIdentitySegment(`production-${contentSourceId}`, "contentSourceId"),
    encodeCacheIdentitySegment(`prod-${contentSourceId}`, "contentSourceId"),
  ]);

  // Render cache keys: {projectId}:{environment}:{releaseKey}:{version}:...
  if (
    parts[0] === encodedProjectId &&
    (parts[1] === "production" || parts[1] === "preview") &&
    parts[2]
  ) {
    return candidates.has(parts[2]);
  }

  // SSR module cache keys: v{version}:{projectId}:{contentSourceId}:...
  if (parts[0]?.startsWith("v") && parts[1] === encodedProjectId) {
    const source = getVersionedContentSourceSegment(normalizedKey, encodedProjectId);
    return source !== null && candidates.has(source);
  }

  // Layout component cache keys: layout:{projectId}:{contentSourceId}:...
  if (parts[0] === "layout" && parts[1] === encodedProjectId && parts[2]) {
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

/** Process-wide registry used for cache diagnostics and targeted invalidation. */
export const cacheRegistry = new CacheRegistry();

export function registerMapCache(name: string, map: CacheStatsSource): void {
  cacheRegistry.register(new MapCacheStore(name, map));
}

/** Register an LRU-compatible cache for diagnostics and invalidation. */
export function registerLRUCache(name: string, cache: CacheStatsSource): void {
  cacheRegistry.register(new LRUCacheStore(name, cache));
}
