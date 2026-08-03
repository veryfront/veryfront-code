import type {
  DistributedCacheAdministration,
  DistributedCacheKeyListing,
  DistributedCacheListOptions,
} from "veryfront/extensions/distributed/cache-support";
import type {
  RedisClient,
  RedisClientManager,
  RedisClientOptions,
} from "./redis-client-manager.ts";
import { isRedisAtomicCounterKey, REDIS_LOGICAL_DELETE_SCRIPT } from "./cache-backend.ts";
import { parseRevisionedCacheRecord } from "./revisioned-cache-record.ts";
import {
  REVISIONED_CACHE_KEY_PREFIX,
  stripOwnedDistributedCacheKeyPrefix,
} from "veryfront/extensions/distributed/cache-support";

const SCAN_COUNT = 100;
const DELETE_BATCH_SIZE = 1_000;
const MAX_SCAN_ITERATIONS = 10_000;
const MAX_SCANNED_KEYS = 100_000;

function escapeRedisGlobLiteral(value: string): string {
  return value.replace(/[\\*?\[\]]/g, "\\$&");
}

function requireScanResult(
  value: Awaited<ReturnType<RedisClient["scan"]>>,
  prefix: string,
): { cursor: number; keys: readonly string[] } {
  if (
    !value ||
    !Number.isSafeInteger(value.cursor) ||
    value.cursor < 0 ||
    !Array.isArray(value.keys) ||
    !value.keys.every((key) => typeof key === "string" && key.startsWith(prefix))
  ) {
    throw new TypeError("Redis returned an invalid cache-administration SCAN result");
  }
  return value;
}

/** Keep Redis cursor and command semantics behind the provider contract. */
export function createRedisCacheAdministration(
  manager: RedisClientManager,
  clientOptions: RedisClientOptions,
): DistributedCacheAdministration {
  const connection = Object.freeze({ ...clientOptions });
  return Object.freeze({
    isConfigured(): boolean {
      return manager.isConfigured(connection);
    },
    async listKeys(
      { prefix, limit }: DistributedCacheListOptions,
    ): Promise<DistributedCacheKeyListing> {
      const client = await manager.getClient(connection);
      const keys = new Set<string>();
      const seenPhysicalKeys = new Set<string>();
      const seenCursors = new Set<number>();
      let cursor = 0;
      let iterations = 0;
      let scanned = 0;

      do {
        if (iterations++ >= MAX_SCAN_ITERATIONS) {
          throw new RangeError("Redis cache administration exceeded the SCAN iteration limit");
        }
        if (seenCursors.has(cursor)) {
          throw new Error("Redis cache administration repeated a SCAN cursor");
        }
        seenCursors.add(cursor);
        const page = requireScanResult(
          await client.scan(cursor, {
            MATCH: `${escapeRedisGlobLiteral(prefix)}*`,
            COUNT: SCAN_COUNT,
          }),
          prefix,
        );
        cursor = page.cursor;
        scanned += page.keys.length;
        if (scanned > MAX_SCANNED_KEYS) {
          throw new RangeError("Redis cache administration exceeded the key traversal limit");
        }
        const candidates = page.keys.filter((key) => {
          if (seenPhysicalKeys.has(key)) return false;
          seenPhysicalKeys.add(key);
          return true;
        });
        if (candidates.length === 0) continue;
        const values = await client.mGet([...candidates]);
        if (
          !Array.isArray(values) ||
          values.length !== candidates.length ||
          !values.every((value) => value === null || typeof value === "string")
        ) {
          throw new TypeError("Redis returned an invalid cache-administration MGET result");
        }
        for (let index = 0; index < candidates.length; index++) {
          const key = candidates[index]!;
          const value = values[index];
          if (value === null) continue;
          if (stripOwnedDistributedCacheKeyPrefix(key).startsWith(REVISIONED_CACHE_KEY_PREFIX)) {
            const record = parseRevisionedCacheRecord(value);
            if (record.kind === "absent") continue;
          }
          if (keys.size === limit) {
            return Object.freeze({ keys: Object.freeze([...keys]), truncated: true });
          }
          keys.add(key);
        }
      } while (cursor !== 0);

      return Object.freeze({ keys: Object.freeze([...keys]), truncated: false });
    },
    async deleteKeys(keys: readonly string[]): Promise<number> {
      if (keys.length === 0) return 0;
      if (keys.some(isRedisAtomicCounterKey)) {
        throw new TypeError("Redis atomic counters are protected from cache administration");
      }
      const client = await manager.getClient(connection);
      let deleted = 0;
      for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
        const batch = keys.slice(index, index + DELETE_BATCH_SIZE) as string[];
        const classifications = batch.map((key) =>
          stripOwnedDistributedCacheKeyPrefix(key).startsWith(REVISIONED_CACHE_KEY_PREFIX)
            ? "1"
            : "0"
        ).join("");
        const count = await client.eval(REDIS_LOGICAL_DELETE_SCRIPT, {
          keys: batch,
          arguments: [classifications, "vf-logical-delete-v1"],
        });
        if (
          typeof count !== "number" ||
          !Number.isSafeInteger(count) ||
          count < 0 ||
          count > batch.length
        ) {
          throw new TypeError("Redis returned an invalid cache-administration DEL count");
        }
        deleted += count;
      }
      return deleted;
    },
  });
}
