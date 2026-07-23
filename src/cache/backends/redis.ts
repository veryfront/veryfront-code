import { logger as baseLogger } from "#veryfront/utils";
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  getRedisClient,
  isRedisConfigured,
  type RedisClient,
} from "#veryfront/utils/redis-client.ts";
import type { CacheBackend } from "../types.ts";
import { buildBatchResults } from "../batch-results.ts";
import {
  CACHE_ERROR,
  INVALID_ARGUMENT,
  SERVICE_OVERLOADED,
  VeryfrontError,
} from "#veryfront/errors";
import { containsUnsafeCacheStringCharacter } from "../validation.ts";

const logger = baseLogger.component("redis-cache-backend");
const REDIS_PATTERN_DELETE_SCAN_COUNT = 100;
const REDIS_PATTERN_DELETE_BATCH_SIZE = 1000;
const MAX_REDIS_SCAN_ITERATIONS = 100_000;
const MAX_REDIS_SCAN_KEYS_PER_RESPONSE = 10_000;
const MAX_REDIS_SCAN_VISITED_KEYS = 1_000_000;
const MAX_CACHE_KEY_LENGTH = 4096;
const MAX_CACHE_PREFIX_LENGTH = 512;
const MAX_CACHE_BATCH_ENTRIES = 100;
const MAX_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;
const MAX_CACHE_VALUE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_BATCH_VALUE_BYTES = MAX_CACHE_VALUE_BYTES;
const valueEncoder = new TextEncoder();

function invalidArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function redisFailure(operation: string): never {
  throw CACHE_ERROR.create({ detail: `Redis cache ${operation} failed` });
}

function assertBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== "string" || (!allowEmpty && value.length === 0) ||
    value.length > maxLength || containsUnsafeCacheStringCharacter(value)
  ) {
    invalidArgument(
      `${label} must be a bounded string without control characters or unpaired UTF-16 surrogates`,
    );
  }
}

function assertCacheKey(key: unknown): asserts key is string {
  assertBoundedString(key, "Cache key", MAX_CACHE_KEY_LENGTH);
}

function normalizeCacheValue(value: unknown): { value: string; byteLength: number } {
  if (typeof value !== "string" || value.length > MAX_CACHE_VALUE_BYTES) {
    invalidArgument("Cache value must be a string within the supported byte size");
  }
  const byteLength = valueEncoder.encode(value).byteLength;
  if (byteLength > MAX_CACHE_VALUE_BYTES) {
    invalidArgument("Cache value must be a string within the supported byte size");
  }
  return { value, byteLength };
}

function assertCacheValue(value: unknown): asserts value is string {
  normalizeCacheValue(value);
}

function isCacheReadValue(value: unknown): value is string | null {
  return value === null ||
    (typeof value === "string" && valueEncoder.encode(value).byteLength <= MAX_CACHE_VALUE_BYTES);
}

function buildBoundedReadResults(
  keys: string[],
  getValue: (key: string) => string | null,
): Map<string, string | null> {
  let totalValueBytes = 0;
  return buildBatchResults(keys, (key) => {
    const value = getValue(key);
    if (value !== null) {
      totalValueBytes += valueEncoder.encode(value).byteLength;
      if (totalValueBytes > MAX_CACHE_BATCH_VALUE_BYTES) {
        redisFailure("batch read response validation");
      }
    }
    return value;
  });
}

function normalizeDeleteCount(value: unknown, requestedCount: number): number {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 ||
    value > requestedCount
  ) {
    redisFailure("delete response validation");
  }
  return value;
}

function normalizeTtl(ttlSeconds: unknown, fallback = 300): number {
  const ttl = ttlSeconds ?? fallback;
  if (
    typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0 ||
    ttl > MAX_CACHE_TTL_SECONDS
  ) {
    invalidArgument("Cache TTL must be a positive finite number within the supported range");
  }
  return ttl;
}

function normalizeScanCursor(cursor: unknown): number {
  const normalized = typeof cursor === "string" && /^\d+$/.test(cursor) ? Number(cursor) : cursor;
  if (
    typeof normalized !== "number" || !Number.isSafeInteger(normalized) || normalized < 0
  ) {
    redisFailure("scan");
  }
  return normalized;
}

// Re-export for use by factory
export { isRedisConfigured };

export class RedisCacheBackend implements CacheBackend {
  readonly type = "redis" as const;
  private client: RedisClient | null = null;
  private readonly keyPrefix: string;

  constructor(keyPrefix = "vf:cache:") {
    assertBoundedString(keyPrefix, "Redis cache key prefix", MAX_CACHE_PREFIX_LENGTH, true);
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
          logger.warn("Failed to connect", {
            errorName: error instanceof Error ? error.name : typeof error,
          });
          return false;
        }
      },
      { "cache.backend": "redis" },
    );
  }

  async get(key: string): Promise<string | null> {
    assertCacheKey(key);
    if (!this.client) return null;

    try {
      const value: unknown = await this.client.get(this.prefixKey(key));
      if (!isCacheReadValue(value)) {
        logger.warn("Redis cache returned an invalid get response");
        return null;
      }
      return value;
    } catch (error) {
      logger.debug("Get failed", { errorName: error instanceof Error ? error.name : typeof error });
      return null;
    }
  }

  async getRemainingTtlSeconds(key: string): Promise<number | null> {
    assertCacheKey(key);
    if (!this.client?.ttl) return null;

    try {
      const remaining: unknown = await this.client.ttl(this.prefixKey(key));
      if (
        typeof remaining !== "number" || !Number.isSafeInteger(remaining) || remaining < -2
      ) {
        logger.warn("Redis cache returned an invalid TTL response");
        return null;
      }
      if (remaining === -1) return Infinity;
      return remaining >= 0 ? remaining : null;
    } catch (error) {
      logger.debug("TTL lookup failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  }

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    if (!Array.isArray(keys) || keys.length > MAX_CACHE_BATCH_ENTRIES) {
      invalidArgument("Cache batch exceeds the supported entry count");
    }
    for (const key of keys) assertCacheKey(key);
    if (keys.length === 0) return new Map<string, string | null>();

    if (!this.client) {
      return buildBatchResults(keys, () => null);
    }

    try {
      const prefixedKeys = keys.map((key) => this.prefixKey(key));
      let fetched: Array<string | null>;
      try {
        const rawFetched: unknown = await this.client.mGet(prefixedKeys);
        if (
          !Array.isArray(rawFetched) || rawFetched.length !== prefixedKeys.length ||
          rawFetched.some((value) => !isCacheReadValue(value))
        ) {
          redisFailure("batch read response validation");
        }
        fetched = rawFetched;
      } catch (error) {
        logger.debug("GetBatch MGET failed, falling back to GET", {
          keyCount: keys.length,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        const fallbackValues = new Map<string, string | null>();
        for (const key of keys) fallbackValues.set(key, await this.get(key));
        return buildBoundedReadResults(keys, (key) => fallbackValues.get(key) ?? null);
      }
      const values = new Map(
        keys.map((key, index) => [key, fetched[index] ?? null] as const),
      );
      return buildBoundedReadResults(keys, (key) => values.get(key) ?? null);
    } catch (error) {
      logger.debug("GetBatch failed", {
        keyCount: keys.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return buildBatchResults(keys, () => null);
    }
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    assertCacheKey(key);
    assertCacheValue(value);
    const ttl = normalizeTtl(ttlSeconds);
    if (!this.client) redisFailure("write without an initialized client");

    try {
      await this.client.set(this.prefixKey(key), value, { EX: ttl });
    } catch (error) {
      logger.debug("Set failed", { errorName: error instanceof Error ? error.name : typeof error });
      redisFailure("write");
    }
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    if (!Array.isArray(entries) || entries.length > MAX_CACHE_BATCH_ENTRIES) {
      invalidArgument("Cache batch exceeds the supported entry count");
    }
    let totalValueBytes = 0;
    const prepared = entries.map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        invalidArgument("Cache batch entry must be an object");
      }
      let key: unknown;
      let value: unknown;
      let ttl: unknown;
      try {
        key = Reflect.get(entry, "key");
        value = Reflect.get(entry, "value");
        ttl = Reflect.get(entry, "ttl");
      } catch {
        invalidArgument("Cache batch entry must be readable");
      }
      assertCacheKey(key);
      const normalizedValue = normalizeCacheValue(value);
      totalValueBytes += normalizedValue.byteLength;
      if (totalValueBytes > MAX_CACHE_BATCH_VALUE_BYTES) {
        invalidArgument("Cache batch values exceed the supported byte size");
      }
      return { key, value: normalizedValue.value, ttl: normalizeTtl(ttl) };
    });
    if (prepared.length === 0) return;
    if (!this.client) redisFailure("batch write without an initialized client");

    try {
      await Promise.all(
        prepared.map(({ key, value, ttl }) =>
          this.client!.set(this.prefixKey(key), value, { EX: ttl })
        ),
      );
    } catch (error) {
      logger.debug("SetBatch failed", {
        entryCount: prepared.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      redisFailure("batch write");
    }
  }

  async del(key: string): Promise<void> {
    assertCacheKey(key);
    if (!this.client) redisFailure("delete without an initialized client");

    try {
      normalizeDeleteCount(await this.client.del(this.prefixKey(key)), 1);
    } catch (error) {
      logger.debug("Del failed", { errorName: error instanceof Error ? error.name : typeof error });
      redisFailure("delete");
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    assertCacheKey(pattern);
    if (!this.client) redisFailure("pattern delete without an initialized client");

    try {
      const client = this.client;
      const fullPattern = this.prefixKey(pattern);
      let cursor = 0;
      const keysToDelete: string[] = [];
      let deletedCount = 0;
      let scanIterations = 0;
      let visitedKeys = 0;
      const seenCursors = new Set<number>();

      const flushDeleteBatch = async (): Promise<void> => {
        if (!keysToDelete.length) return;
        const batch = keysToDelete.splice(0, keysToDelete.length);
        deletedCount += normalizeDeleteCount(await client.del(batch), batch.length);
      };

      do {
        scanIterations++;
        if (scanIterations > MAX_REDIS_SCAN_ITERATIONS) redisFailure("scan");
        const result = await client.scan(cursor, {
          MATCH: fullPattern,
          COUNT: REDIS_PATTERN_DELETE_SCAN_COUNT,
        });
        const nextCursor = normalizeScanCursor(result.cursor);
        if (nextCursor !== 0 && seenCursors.has(nextCursor)) redisFailure("scan");
        if (nextCursor !== 0) seenCursors.add(nextCursor);
        cursor = nextCursor;
        if (!Array.isArray(result.keys) || result.keys.length > MAX_REDIS_SCAN_KEYS_PER_RESPONSE) {
          redisFailure("scan");
        }
        visitedKeys += result.keys.length;
        if (visitedKeys > MAX_REDIS_SCAN_VISITED_KEYS) {
          throw SERVICE_OVERLOADED.create({
            message: "Redis pattern deletion exceeds the supported visited-key count",
          });
        }
        for (const scannedKey of result.keys) {
          assertBoundedString(
            scannedKey,
            "Redis cache scan key",
            MAX_CACHE_PREFIX_LENGTH + MAX_CACHE_KEY_LENGTH,
          );
          keysToDelete.push(scannedKey);
        }

        while (keysToDelete.length >= REDIS_PATTERN_DELETE_BATCH_SIZE) {
          const batch = keysToDelete.splice(0, REDIS_PATTERN_DELETE_BATCH_SIZE);
          deletedCount += normalizeDeleteCount(await client.del(batch), batch.length);
        }
      } while (cursor !== 0);

      await flushDeleteBatch();
      return deletedCount;
    } catch (error) {
      logger.debug("DelByPattern failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      if (error instanceof VeryfrontError) throw error;
      redisFailure("pattern delete");
    }
  }
}
