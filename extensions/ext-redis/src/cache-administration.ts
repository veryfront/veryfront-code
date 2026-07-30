import type {
  DistributedCacheAdministration,
  DistributedCacheKeyListing,
  DistributedCacheListOptions,
} from "veryfront/extensions/distributed";
import type {
  RedisClient,
  RedisClientManager,
  RedisClientOptions,
} from "./redis-client-manager.ts";

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
        for (const key of page.keys) {
          if (keys.has(key)) continue;
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
      const client = await manager.getClient(connection);
      let deleted = 0;
      for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
        const batch = keys.slice(index, index + DELETE_BATCH_SIZE) as string[];
        const count = await client.del(batch);
        if (!Number.isSafeInteger(count) || count < 0 || count > batch.length) {
          throw new TypeError("Redis returned an invalid cache-administration DEL count");
        }
        deleted += count;
      }
      return deleted;
    },
  });
}
