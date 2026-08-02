import { createError, toError } from "#veryfront/errors";
import { OwnedRedisClientConnection } from "#veryfront/extensions/distributed/owned-redis-client.ts";
import type { RedisClient } from "#veryfront/extensions/distributed";
import { serverLogger } from "#veryfront/utils";
import type { RateLimitEntry, RateLimitStore } from "./types.ts";

const logger = serverLogger.component("redis-ratelimit");

const INCREMENT_WITH_TTL_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

/** Options accepted by redis rate limit. */
export interface RedisRateLimitOptions {
  url?: string;
  keyPrefix?: string;
}

/** Implement redis rate limit store. */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly connection: OwnedRedisClientConnection;
  private readonly keyPrefix: string;

  constructor(options: RedisRateLimitOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? "veryfront:ratelimit:";
    this.connection = new OwnedRedisClientConnection(
      options.url === undefined ? {} : { url: options.url },
      {
        onError(error) {
          logger.error("client error", error);
        },
        onCloseError(error) {
          logger.error("client close failed", error);
        },
      },
    );
  }

  private ensureClient(): Promise<RedisClient> {
    return this.connection.getClient();
  }

  private storageKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const client = await this.ensureClient();
    const redisKey = this.storageKey(key);

    const [count, pttl] = parseIncrementResult(
      await client.eval(INCREMENT_WITH_TTL_SCRIPT, {
        keys: [redisKey],
        arguments: [String(windowMs)],
      }),
    );
    const ttl = pttl > 0 ? pttl : windowMs;
    return { count, resetAt: Date.now() + ttl };
  }

  async reset(key: string): Promise<void> {
    const client = await this.ensureClient();
    await client.del(this.storageKey(key));
  }

  async destroy(): Promise<void> {
    await this.connection.close();
  }
}

function parseIncrementResult(result: unknown): [number, number] {
  if (!Array.isArray(result) || result.length < 2) {
    throw toError(
      createError({
        type: "config",
        message: "Redis rate limit eval returned an invalid result.",
      }),
    );
  }

  const count = Number(result[0]);
  const ttl = Number(result[1]);

  if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
    throw toError(
      createError({
        type: "config",
        message: "Redis rate limit eval returned non-numeric values.",
      }),
    );
  }

  return [count, ttl];
}
