import { logger as baseLogger } from "veryfront/utils/logger";
import { type Span, SpanNames } from "veryfront/observability";
import { withSpan } from "veryfront/observability/otlp-setup";
import { isProxy as isProxyWithoutHooks } from "node:util/types";
import {
  disconnectRedisClient,
  getRedisClient,
  isRedisConfigured,
  type RedisClient,
  type RedisClientManager,
  type RedisClientOptions,
} from "./redis-client-manager.ts";
import {
  assertCacheBatchSize,
  assertCacheReadMaximumBytes,
  assertCacheValueWithinLimit,
  buildBatchResults,
  type CacheBackend,
  type CacheRevisionMutation,
  type CacheRevisionSnapshot,
  CacheValueTooLargeError,
  DEFAULT_CACHE_TTL_SECONDS,
  escapeCacheGlobLiteral,
  expiresImmediately,
  isRevisionedCacheKey,
  resolveIntegerCacheTtlSeconds,
  REVISIONED_CACHE_KEY_PREFIX,
  type RevisionedCacheBackend,
  validateDistributedCacheKeyPrefix,
} from "veryfront/extensions/distributed/cache-support";
import {
  parseRedisRevisionExchangeResult,
  parseRedisRevisionReadResult,
  parseRevisionedCacheRecord,
} from "./revisioned-cache-record.ts";

const logger = baseLogger.component("redis-cache-backend");
const REDIS_PATTERN_DELETE_SCAN_COUNT = 100;
const REDIS_PATTERN_DELETE_BATCH_SIZE = 1_000;
const MAX_REDIS_PATTERN_DELETE_KEYS = 100_000;
const MAX_REDIS_SCAN_ITERATIONS = 1_000_000;
const ATOMIC_COUNTER_KEY_PREFIX = "\0vf:cache:atomic:v1:counter:";
const ATOMIC_TOMBSTONE_TTL_MS = 300_000;
const MAX_SIGNED_REDIS_INTEGER = "9223372036854775807";

const REDIS_BOUNDED_GET_SCRIPT = String.raw`
if #KEYS ~= 1 or #ARGV ~= 2 then
  error('Veryfront bounded cache read received invalid inputs', 0)
end
local limit = tonumber(ARGV[1])
if limit == nil or limit < 0 or limit ~= math.floor(limit) then
  error('Veryfront bounded cache read limit is invalid', 0)
end
local mode = ARGV[2]
if mode ~= 'ordinary' and mode ~= 'revisioned' then
  error('Veryfront bounded cache read mode is invalid', 0)
end
local size = redis.call('STRLEN', KEYS[1])
if size == 0 and redis.call('EXISTS', KEYS[1]) == 0 then return {0} end
if mode == 'ordinary' then
  if size > limit then return {2, tostring(size)} end
  return {1, redis.call('GET', KEYS[1])}
end

local nul = string.char(0)
local frame_prefix = nul .. 'VFCAS1' .. nul
local max_revision = '9223372036854775807'
local header = redis.call(
  'GETRANGE',
  KEYS[1],
  0,
  #frame_prefix + 2 + #max_revision
)
if string.sub(header, 1, #frame_prefix) ~= frame_prefix then
  error('Veryfront revisioned cache record is malformed', 0)
end
local state_index = #frame_prefix + 1
local state = string.sub(header, state_index, state_index)
if (state ~= 'p' and state ~= 'a') or
  string.sub(header, state_index + 1, state_index + 1) ~= nul then
  error('Veryfront revisioned cache record state is malformed', 0)
end
local revision_start = state_index + 2
local revision_end = string.find(header, nul, revision_start, true)
if revision_end == nil then
  error('Veryfront revisioned cache record revision is malformed', 0)
end
local revision = string.sub(header, revision_start, revision_end - 1)
if string.match(revision, '^[1-9][0-9]*$') == nil or
  #revision > #max_revision or
  (#revision == #max_revision and revision > max_revision) then
  error('Veryfront revisioned cache record revision is invalid', 0)
end
local payload_size = size - revision_end
if state == 'a' then
  if payload_size ~= 0 then
    error('Veryfront absent revisioned cache record contains a payload', 0)
  end
  return {0}
end
if payload_size > limit then return {2, tostring(payload_size)} end
return {1, redis.call('GETRANGE', KEYS[1], revision_end, -1)}
`;

const LUA_RECORD_LIBRARY = String.raw`
local nul = string.char(0)
local frame_prefix = nul .. 'VFCAS1' .. nul
local max_counter = '9223372036854775807'

local function fail(message)
  error(message, 0)
end

local function is_canonical_decimal(value, allow_zero, maximum)
  if type(value) ~= 'string' then return false end
  if value == '0' then return allow_zero end
  if string.match(value, '^[1-9][0-9]*$') == nil then return false end
  if #value > #maximum then return false end
  if #value == #maximum and value > maximum then return false end
  return true
end

local function decimal_lte(left, right)
  if #left ~= #right then return #left < #right end
  return left <= right
end

local function require_counter()
  local counter = redis.call('GET', KEYS[2])
  if not is_canonical_decimal(counter, true, max_counter) then
    fail('Veryfront atomic counter is missing or malformed')
  end
  if redis.call('TTL', KEYS[2]) ~= -1 then
    fail('Veryfront atomic counter must not expire')
  end
  return counter
end

local function allocate_revision()
  redis.call('INCR', KEYS[2])
  local revision = redis.call('GET', KEYS[2])
  if not is_canonical_decimal(revision, false, max_counter) then
    fail('Veryfront atomic counter did not produce a valid revision')
  end
  return revision
end

local function parse_record(raw, counter)
  if type(raw) ~= 'string' or string.sub(raw, 1, #frame_prefix) ~= frame_prefix then
    fail('Veryfront revisioned cache record is malformed')
  end
  local state_index = #frame_prefix + 1
  local state = string.sub(raw, state_index, state_index)
  if (state ~= 'p' and state ~= 'a') or string.sub(raw, state_index + 1, state_index + 1) ~= nul then
    fail('Veryfront revisioned cache record state is malformed')
  end
  local revision_start = state_index + 2
  local revision_end = string.find(raw, nul, revision_start, true)
  if revision_end == nil then fail('Veryfront revisioned cache record revision is malformed') end
  local revision = string.sub(raw, revision_start, revision_end - 1)
  if not is_canonical_decimal(revision, false, max_counter) or not decimal_lte(revision, counter) then
    fail('Veryfront revisioned cache record revision is invalid')
  end
  local payload = string.sub(raw, revision_end + 1)
  if state == 'a' and #payload ~= 0 then
    fail('Veryfront absent revisioned cache record contains a payload')
  end
  return state, revision, payload
end

local function absent_frame(revision)
  return frame_prefix .. 'a' .. nul .. revision .. nul
end

local function present_frame(revision, payload)
  return frame_prefix .. 'p' .. nul .. revision .. nul .. payload
end
`;

const REDIS_REVISION_READ_SCRIPT = `${LUA_RECORD_LIBRARY}
if #KEYS ~= 2 or #ARGV ~= 0 then fail('Veryfront revision read received invalid inputs') end
local counter = require_counter()
local raw = redis.call('GET', KEYS[1])
if raw == false then
  local revision = allocate_revision()
  redis.call('SET', KEYS[1], absent_frame(revision), 'PX', '${ATOMIC_TOMBSTONE_TTL_MS}')
  return {0, revision}
end
local state, revision, payload = parse_record(raw, counter)
if state == 'a' then return {0, revision} end
return {1, revision, payload}
`;

const REDIS_REVISION_EXCHANGE_SCRIPT = `${LUA_RECORD_LIBRARY}
if #KEYS ~= 2 then fail('Veryfront revision exchange received invalid keys') end
if #ARGV < 2 then fail('Veryfront revision exchange received invalid arguments') end
local expected = ARGV[1]
local operation = ARGV[2]
if not is_canonical_decimal(expected, false, max_counter) then
  fail('Veryfront revision exchange expected revision is invalid')
end
if operation == 'd' then
  if #ARGV ~= 2 then fail('Veryfront delete mutation received invalid arguments') end
elseif operation == 's' then
  if #ARGV ~= 4 or type(ARGV[3]) ~= 'string' then
    fail('Veryfront set mutation received invalid arguments')
  end
  local max_safe_integer = '9007199254740991'
  if not is_canonical_decimal(ARGV[4], false, max_safe_integer) then
    fail('Veryfront set mutation deadline is invalid')
  end
else
  fail('Veryfront revision exchange operation is invalid')
end

local counter = require_counter()
local raw = redis.call('GET', KEYS[1])
if raw == false then
  local revision = allocate_revision()
  redis.call('SET', KEYS[1], absent_frame(revision), 'PX', '${ATOMIC_TOMBSTONE_TTL_MS}')
  return 0
end
local _, current_revision = parse_record(raw, counter)
if current_revision ~= expected then return 0 end

local revision = allocate_revision()
if operation == 'd' then
  redis.call('SET', KEYS[1], absent_frame(revision), 'PX', '${ATOMIC_TOMBSTONE_TTL_MS}')
  return 1
end

local server_time = redis.call('TIME')
local now_ms = (tonumber(server_time[1]) * 1000) + math.floor(tonumber(server_time[2]) / 1000)
local deadline_ms = tonumber(ARGV[4])
if deadline_ms <= now_ms then
  redis.call('SET', KEYS[1], absent_frame(revision), 'PX', '${ATOMIC_TOMBSTONE_TTL_MS}')
else
  redis.call('SET', KEYS[1], present_frame(revision, ARGV[3]), 'PXAT', ARGV[4])
end
return 1
`;

export const REDIS_LOGICAL_DELETE_SCRIPT = `${LUA_RECORD_LIBRARY}
if #KEYS == 0 or #ARGV ~= 2 or ARGV[2] ~= 'vf-logical-delete-v1' then
  fail('Veryfront logical deletion received invalid inputs')
end
local classifications = ARGV[1]
if #classifications ~= #KEYS or string.match(classifications, '^[01]+$') == nil then
  fail('Veryfront logical deletion classifications are invalid')
end
local live = 0
for index, key in ipairs(KEYS) do
  local raw = redis.call('GET', key)
  if raw ~= false then
    local is_reserved = string.sub(classifications, index, index) == '1'
    if is_reserved then
      if string.sub(raw, 1, #frame_prefix) ~= frame_prefix then
        fail('Veryfront revisioned cache record is malformed')
      end
      local state_index = #frame_prefix + 1
      local state = string.sub(raw, state_index, state_index)
      if (state ~= 'p' and state ~= 'a') or string.sub(raw, state_index + 1, state_index + 1) ~= nul then
        fail('Veryfront revisioned cache record state is malformed')
      end
      local revision_start = state_index + 2
      local revision_end = string.find(raw, nul, revision_start, true)
      if revision_end == nil then fail('Veryfront revisioned cache record revision is malformed') end
      local revision = string.sub(raw, revision_start, revision_end - 1)
      if not is_canonical_decimal(revision, false, max_counter) then
        fail('Veryfront revisioned cache record revision is invalid')
      end
      local payload = string.sub(raw, revision_end + 1)
      if state == 'a' and #payload ~= 0 then
        fail('Veryfront absent revisioned cache record contains a payload')
      end
      if state == 'p' then live = live + 1 end
    else
      live = live + 1
    end
  end
end
redis.call('DEL', unpack(KEYS))
return live
`;

function readStrictInfoField(info: unknown, field: string): string | null {
  if (typeof info !== "string") return null;
  let result: string | null = null;
  for (const line of info.split(/\r?\n/)) {
    if (!line.startsWith(`${field}:`)) continue;
    if (result !== null) return null;
    const value = line.slice(field.length + 1);
    if (value.length === 0 || !/^[!-~]+$/.test(value)) return null;
    result = value;
  }
  return result;
}

function isCanonicalCounter(value: unknown): value is string {
  return typeof value === "string" &&
    /^(0|[1-9]\d*)$/.test(value) &&
    value.length <= MAX_SIGNED_REDIS_INTEGER.length &&
    (value.length < MAX_SIGNED_REDIS_INTEGER.length || value <= MAX_SIGNED_REDIS_INTEGER);
}

function isRevisionedCachePrefixOwned(key: string): boolean {
  return key.startsWith(REVISIONED_CACHE_KEY_PREFIX);
}

function parseRedisBoundedReadResult(
  value: unknown,
  maximumBytes: number,
): { kind: "missing" } | { kind: "present"; value: string } | { kind: "oversized" } {
  if (!Array.isArray(value) || isProxyWithoutHooks(value)) {
    throw new TypeError("Redis bounded cache read returned an invalid result");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const firstDescriptor = Object.getOwnPropertyDescriptor(value, "0");
  const secondDescriptor = Object.getOwnPropertyDescriptor(value, "1");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  const tag = firstDescriptor && "value" in firstDescriptor ? firstDescriptor.value : undefined;
  if (!Number.isSafeInteger(length) || (length !== 1 && length !== 2)) {
    throw new TypeError("Redis bounded cache read returned an invalid result");
  }
  const expectedKeys = length === 1 ? ["0", "length"] : ["0", "1", "length"];
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) {
    throw new TypeError("Redis bounded cache read returned an invalid result");
  }
  if (tag === 0 && length === 1) return { kind: "missing" };
  if (
    tag === 1 &&
    length === 2 &&
    secondDescriptor &&
    "value" in secondDescriptor &&
    typeof secondDescriptor.value === "string"
  ) {
    return { kind: "present", value: secondDescriptor.value };
  }
  if (
    tag === 2 &&
    length === 2 &&
    secondDescriptor &&
    "value" in secondDescriptor &&
    typeof secondDescriptor.value === "string" &&
    /^[1-9]\d*$/.test(secondDescriptor.value) &&
    Number.isSafeInteger(Number(secondDescriptor.value)) &&
    Number(secondDescriptor.value) > maximumBytes
  ) {
    return { kind: "oversized" };
  }
  throw new TypeError("Redis bounded cache read returned an invalid result");
}

function requireRedisRevisionMutation(value: unknown): CacheRevisionMutation {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const kindDescriptor = descriptors.kind;
    if (!kindDescriptor || !Object.hasOwn(kindDescriptor, "value")) {
      throw new TypeError();
    }

    if (kindDescriptor.value === "delete") {
      if (keys.length !== 1 || keys[0] !== "kind") throw new TypeError();
      return Object.freeze({ kind: "delete" });
    }
    if (kindDescriptor.value !== "set" || keys.length !== 3) throw new TypeError();
    if (!keys.includes("kind") || !keys.includes("value") || !keys.includes("expiresAtMs")) {
      throw new TypeError();
    }
    const valueDescriptor = descriptors.value;
    const deadlineDescriptor = descriptors.expiresAtMs;
    if (
      !valueDescriptor ||
      !deadlineDescriptor ||
      !Object.hasOwn(valueDescriptor, "value") ||
      !Object.hasOwn(deadlineDescriptor, "value") ||
      typeof valueDescriptor.value !== "string" ||
      typeof deadlineDescriptor.value !== "number" ||
      !Number.isSafeInteger(deadlineDescriptor.value) ||
      deadlineDescriptor.value <= 0
    ) {
      throw new TypeError();
    }
    return Object.freeze({
      kind: "set",
      value: valueDescriptor.value,
      expiresAtMs: deadlineDescriptor.value,
    });
  } catch {
    throw new TypeError("Redis revision mutation has an invalid runtime shape");
  }
}

function isAtomicRedisTopology(
  serverInfo: unknown,
  clusterInfo: unknown,
  memoryInfo: unknown,
): boolean {
  const version = readStrictInfoField(serverInfo, "redis_version");
  const redisMode = readStrictInfoField(serverInfo, "redis_mode");
  const clusterEnabled = readStrictInfoField(clusterInfo, "cluster_enabled");
  const evictionPolicy = readStrictInfoField(memoryInfo, "maxmemory_policy");
  return version !== null && /^7\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) &&
    redisMode === "standalone" &&
    clusterEnabled === "0" &&
    evictionPolicy !== null &&
    (evictionPolicy === "noeviction" ||
      evictionPolicy === "volatile-lru" ||
      evictionPolicy === "volatile-lfu" ||
      evictionPolicy === "volatile-random" ||
      evictionPolicy === "volatile-ttl");
}

/** Test whether a physical Redis key is the protected namespace counter. */
export function isRedisAtomicCounterKey(key: unknown): key is string {
  return typeof key === "string" && key.startsWith(ATOMIC_COUNTER_KEY_PREFIX);
}

const sharedRedisClientManager: RedisClientManager = {
  getClient: getRedisClient,
  disconnect: disconnectRedisClient,
  isConfigured: isRedisConfigured,
};

export interface RedisCacheBackendOptions {
  clientManager?: RedisClientManager;
  clientOptions?: RedisClientOptions;
}

// Re-export for use by factory
export { isRedisConfigured };

export class RedisCacheBackend implements CacheBackend {
  /**
   * Reports `"redis"`, a real member of `CacheBackendType`. This previously
   * read `"distributed"`, which was never a member of that union, so the wider
   * annotation was hiding a contract violation. Core's own Redis backend
   * already reports `"redis"` (`src/cache/backends/redis.ts`), and the only
   * in-repo consumer branches on `type !== "memory"`
   * (`src/cache/backends/factory.ts`). If you branch on this value from
   * outside the repo, read `"redis"`.
   */
  readonly type = "redis" as const;
  declare getWithRevision?: RevisionedCacheBackend["getWithRevision"];
  declare compareExchange?: RevisionedCacheBackend["compareExchange"];
  private readonly keyPrefix: string;
  private readonly atomicCounterKey: string;
  private readonly clientManager: RedisClientManager;
  private readonly clientOptions: RedisClientOptions;

  constructor(keyPrefix = "vf:cache:default:", options: RedisCacheBackendOptions = {}) {
    this.keyPrefix = validateDistributedCacheKeyPrefix(keyPrefix);
    this.atomicCounterKey = `${ATOMIC_COUNTER_KEY_PREFIX}${this.keyPrefix}`;
    this.clientManager = options.clientManager ?? sharedRedisClientManager;
    this.clientOptions = Object.freeze({ ...options.clientOptions });
  }

  private prefixKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private async resetAfterFailure(error: unknown): Promise<void> {
    this.clearRevisionCapability();
    try {
      await this.clientManager.disconnect();
    } catch (disconnectError) {
      logger.warn("Failed to reset Redis connection", { error, disconnectError });
    }
  }

  private clearRevisionCapability(): void {
    delete this.getWithRevision;
    delete this.compareExchange;
  }

  private publishRevisionCapability(): void {
    Object.defineProperties(this, {
      getWithRevision: {
        value: this.readWithRevision.bind(this),
        configurable: true,
        enumerable: true,
        writable: true,
      },
      compareExchange: {
        value: this.exchangeRevision.bind(this),
        configurable: true,
        enumerable: true,
        writable: true,
      },
    });
  }

  private async probeRevisionCapability(client: RedisClient): Promise<boolean> {
    if (typeof client.ttl !== "function" || typeof client.info !== "function") return false;
    try {
      const [serverInfo, clusterInfo, memoryInfo] = await Promise.all([
        client.info("server"),
        client.info("cluster"),
        client.info("memory"),
      ]);
      if (!isAtomicRedisTopology(serverInfo, clusterInfo, memoryInfo)) return false;

      const created = await client.set(this.atomicCounterKey, "0", { NX: true });
      if (created !== "OK" && created !== null) return false;
      const [counter, ttl] = await Promise.all([
        client.get(this.atomicCounterKey),
        client.ttl(this.atomicCounterKey),
      ]);
      return isCanonicalCounter(counter) && ttl === -1;
    } catch (error) {
      logger.debug("Atomic revision capability probe failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return false;
    }
  }

  private async getClientForRead(): Promise<RedisClient | null> {
    if (!this.clientManager.isConfigured(this.clientOptions)) return null;
    try {
      return await this.clientManager.getClient(this.clientOptions);
    } catch (error) {
      logger.debug("Redis client acquisition failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  }

  private async requireClient(): Promise<RedisClient> {
    if (!this.clientManager.isConfigured(this.clientOptions)) {
      throw new Error("Redis cache backend is not configured");
    }
    return await this.clientManager.getClient(this.clientOptions);
  }

  initialize(): Promise<boolean> {
    this.clearRevisionCapability();
    if (!this.clientManager.isConfigured(this.clientOptions)) return Promise.resolve(false);

    return withSpan(
      SpanNames.CACHE_DISTRIBUTED_INIT,
      async (span?: Span) => {
        try {
          const client = await this.clientManager.getClient(this.clientOptions);
          const revisioned = await this.probeRevisionCapability(client);
          if (revisioned) this.publishRevisionCapability();
          span?.setAttribute("cache.redis.connected", true);
          span?.setAttribute("cache.redis.atomic_revision", revisioned);
          return true;
        } catch (error) {
          span?.setAttribute("cache.redis.connected", false);
          logger.warn("Failed to connect", {
            errorName: error instanceof Error ? error.name : typeof error,
          });
          return false;
        }
      },
      { "cache.key_prefix": this.keyPrefix },
    );
  }

  async get(key: string): Promise<string | null> {
    const client = await this.getClientForRead();
    if (!client) return null;

    try {
      const value = await client.get(this.prefixKey(key));
      return this.decodeOrdinaryRead(key, value);
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.debug("Get failed", {
        keyLength: key.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  }

  async getWithinLimit(key: string, maximumBytes: number): Promise<string | null> {
    const admittedMaximum = assertCacheReadMaximumBytes(maximumBytes);
    const client = await this.getClientForRead();
    if (!client) return null;
    const mode = isRevisionedCachePrefixOwned(key) ? "revisioned" : "ordinary";

    try {
      const result = parseRedisBoundedReadResult(
        await client.eval(
          REDIS_BOUNDED_GET_SCRIPT,
          {
            keys: [this.prefixKey(key)],
            arguments: [String(admittedMaximum), mode],
          },
        ),
        admittedMaximum,
      );
      if (result.kind === "missing") return null;
      if (result.kind === "oversized") {
        throw new CacheValueTooLargeError(admittedMaximum);
      }
      assertCacheValueWithinLimit(result.value, admittedMaximum);
      return result.value;
    } catch (error) {
      if (error instanceof CacheValueTooLargeError) throw error;
      await this.resetAfterFailure(error);
      logger.debug("Bounded GET failed", {
        keyLength: key.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  }

  private decodeOrdinaryRead(key: string, value: string | null): string | null {
    if (value === null || !isRevisionedCachePrefixOwned(key)) return value;
    if (!isRevisionedCacheKey(key)) {
      throw new TypeError("Redis cache key uses a malformed reserved revisioned namespace");
    }
    const record = parseRevisionedCacheRecord(value);
    return record.kind === "present" ? record.value : null;
  }

  async getRemainingTtlSeconds(key: string): Promise<number | null> {
    const client = await this.getClientForRead();
    if (!client?.ttl) return null;

    try {
      const remaining = await client.ttl(this.prefixKey(key));
      if (remaining === -1) return Infinity;
      return Number.isSafeInteger(remaining) && remaining >= 0 ? remaining : null;
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.debug("TTL lookup failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  }

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    assertCacheBatchSize(keys, "Redis cache getBatch");
    if (keys.length === 0) return new Map<string, string | null>();

    const client = await this.getClientForRead();
    if (!client) return buildBatchResults(keys, () => null);

    try {
      const prefixedKeys = keys.map((key) => this.prefixKey(key));
      const fetched = await client.mGet(prefixedKeys);
      if (
        !Array.isArray(fetched) ||
        fetched.length !== keys.length ||
        !fetched.every((value) => value === null || typeof value === "string")
      ) {
        throw new TypeError("Redis MGET returned an invalid result");
      }
      const values = new Map(keys.map((key, index) =>
        [
          key,
          this.decodeOrdinaryRead(key, fetched[index] ?? null),
        ] as const
      ));
      return buildBatchResults(keys, (key) => values.get(key) ?? null);
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.debug("GetBatch MGET failed, falling back to GET", {
        keyCount: keys.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      const fallbackFetched = await Promise.all(
        keys.map(async (key) => [key, await this.get(key)] as const),
      );
      const fallbackValues = new Map(fallbackFetched);
      return buildBatchResults(keys, (key) => fallbackValues.get(key) ?? null);
    }
  }

  async set(
    key: string,
    value: string,
    ttlSeconds = DEFAULT_CACHE_TTL_SECONDS,
  ): Promise<void> {
    if (isRevisionedCachePrefixOwned(key)) {
      throw new TypeError(
        "Ordinary Redis cache writes cannot use the reserved revisioned namespace",
      );
    }
    const ttl = resolveIntegerCacheTtlSeconds(ttlSeconds, DEFAULT_CACHE_TTL_SECONDS)!;
    if (expiresImmediately(ttl)) {
      await this.del(key);
      return;
    }

    const client = await this.requireClient();
    try {
      const result = await client.set(this.prefixKey(key), value, { EX: ttl });
      if (result !== "OK") throw new Error("Redis SET did not acknowledge the write");
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.debug("Set failed", {
        keyLength: key.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw error;
    }
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    assertCacheBatchSize(entries, "Redis cache setBatch");
    if (entries.length === 0) return;

    for (const { key } of entries) {
      if (isRevisionedCachePrefixOwned(key)) {
        throw new TypeError(
          "Ordinary Redis cache writes cannot use the reserved revisioned namespace",
        );
      }
    }

    const finalEntriesByKey = new Map<string, { key: string; value: string; ttl: number }>();
    for (const { key, value, ttl } of entries) {
      finalEntriesByKey.set(key, {
        key,
        value,
        ttl: resolveIntegerCacheTtlSeconds(ttl, DEFAULT_CACHE_TTL_SECONDS)!,
      });
    }

    const writes = await Promise.allSettled(
      [...finalEntriesByKey.values()].map(({ key, value, ttl }) => this.set(key, value, ttl)),
    );
    const firstFailure = writes.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (firstFailure) throw firstFailure.reason;
  }

  async del(key: string): Promise<void> {
    const client = await this.requireClient();
    try {
      const deleted = await client.del(this.prefixKey(key));
      this.assertDeleteCount(deleted, 1);
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.debug("Del failed", {
        keyLength: key.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw error;
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    const client = await this.requireClient();

    try {
      const fullPattern = `${escapeCacheGlobLiteral(this.keyPrefix)}${pattern}`;
      const keysToDelete = new Set<string>();
      const seenCursors = new Set<number>();
      let cursor = 0;
      let iterations = 0;

      do {
        if (++iterations > MAX_REDIS_SCAN_ITERATIONS) {
          throw new Error("Redis SCAN exceeded the safe iteration limit");
        }
        const result = await client.scan(cursor, {
          MATCH: fullPattern,
          COUNT: REDIS_PATTERN_DELETE_SCAN_COUNT,
        });
        if (
          !result ||
          !Number.isSafeInteger(result.cursor) ||
          result.cursor < 0 ||
          !Array.isArray(result.keys) ||
          !result.keys.every((key) => typeof key === "string" && key.startsWith(this.keyPrefix))
        ) {
          throw new TypeError("Redis returned an invalid SCAN result");
        }
        if (result.cursor !== 0 && seenCursors.has(result.cursor)) {
          throw new Error("Redis SCAN repeated a cursor before completing");
        }
        if (result.cursor !== 0) seenCursors.add(result.cursor);
        for (const key of result.keys) {
          keysToDelete.add(key);
          if (keysToDelete.size > MAX_REDIS_PATTERN_DELETE_KEYS) {
            throw new RangeError("Redis pattern deletion exceeds the safe key limit");
          }
        }
        cursor = result.cursor;
      } while (cursor !== 0);

      const keys = [...keysToDelete];
      let deletedCount = 0;
      for (let index = 0; index < keys.length; index += REDIS_PATTERN_DELETE_BATCH_SIZE) {
        const batch = keys.slice(index, index + REDIS_PATTERN_DELETE_BATCH_SIZE);
        const classifications = batch.map((key) =>
          isRevisionedCachePrefixOwned(key.slice(this.keyPrefix.length)) ? "1" : "0"
        ).join("");
        const deleted = await client.eval(REDIS_LOGICAL_DELETE_SCRIPT, {
          keys: batch,
          arguments: [classifications, "vf-logical-delete-v1"],
        });
        this.assertDeleteCount(deleted, batch.length);
        deletedCount += deleted;
      }
      return deletedCount;
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.debug("DelByPattern failed", {
        patternLength: pattern.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw error;
    }
  }

  private assertDeleteCount(value: unknown, requested: number): asserts value is number {
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > requested
    ) {
      throw new TypeError("Redis DEL returned an invalid count");
    }
  }

  private requireRevisionedKey(key: string): string {
    if (!isRevisionedCacheKey(key)) {
      throw new TypeError("Redis revision operations require the reserved revisioned namespace");
    }
    return this.prefixKey(key);
  }

  private async readWithRevision(key: string): Promise<CacheRevisionSnapshot> {
    const dataKey = this.requireRevisionedKey(key);
    try {
      const client = await this.requireClient();
      const result = await client.eval(REDIS_REVISION_READ_SCRIPT, {
        keys: [dataKey, this.atomicCounterKey],
        arguments: [],
      });
      return parseRedisRevisionReadResult(result);
    } catch (error) {
      await this.resetAfterFailure(error);
      throw error;
    }
  }

  private async exchangeRevision(
    key: string,
    expectedRevision: string,
    mutation: CacheRevisionMutation,
  ): Promise<boolean> {
    const dataKey = this.requireRevisionedKey(key);
    if (typeof expectedRevision !== "string") {
      throw new TypeError("Redis expected revision must be a string");
    }
    const validatedMutation = requireRedisRevisionMutation(mutation);
    const args = validatedMutation.kind === "delete" ? [expectedRevision, "d"] : [
      expectedRevision,
      "s",
      validatedMutation.value,
      String(validatedMutation.expiresAtMs),
    ];
    try {
      const client = await this.requireClient();
      const result = await client.eval(REDIS_REVISION_EXCHANGE_SCRIPT, {
        keys: [dataKey, this.atomicCounterKey],
        arguments: args,
      });
      return parseRedisRevisionExchangeResult(result);
    } catch (error) {
      await this.resetAfterFailure(error);
      throw error;
    }
  }
}
