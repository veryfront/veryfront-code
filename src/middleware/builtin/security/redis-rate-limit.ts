import { createError, toError } from "#veryfront/errors";
import { serverLogger } from "#veryfront/utils";
import type { RateLimitEntry, RateLimitStore } from "./types.ts";

const logger = serverLogger.component("redis-ratelimit");

interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  incr(key: string): Promise<number>;
  pExpire(key: string, milliseconds: number): Promise<boolean>;
  pTTL(key: string): Promise<number>;
  del(key: string): Promise<number>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
}

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
  private client: RedisClient | null = null;
  private clientPromise: Promise<RedisClient> | null = null;
  private readonly url?: string;
  private readonly keyPrefix: string;

  constructor(options: RedisRateLimitOptions = {}) {
    this.url = options.url;
    this.keyPrefix = options.keyPrefix ?? "veryfront:ratelimit:";
  }

  private ensureClient(): Promise<RedisClient> {
    if (this.client) return Promise.resolve(this.client);
    this.clientPromise ??= this.connectClient();
    return this.clientPromise;
  }

  private clearCachedClient(): void {
    this.client = null;
    this.clientPromise = null;
  }

  private attachClientLifecycleHandlers(client: RedisClient): void {
    client.on?.("error", (err: unknown) => {
      logger.error("client error", err);
      this.clearCachedClient();
    });

    client.on?.("end", () => {
      this.clearCachedClient();
    });
  }

  private async connectClient(): Promise<RedisClient> {
    let createClient: (options: { url?: string }) => RedisClient;

    try {
      const redisClientModule = ["npm:@redis/client", "@1.5.8"].join("");
      const mod = await import(redisClientModule);
      createClient = mod.createClient as (options: { url?: string }) => RedisClient;
    } catch (_) {
      // expected: redis client module may not be installed
      this.clientPromise = null;
      throw toError(
        createError({
          type: "config",
          message:
            "Redis rate limit store requires npm:@redis/client. Install dependencies or use MemoryRateLimitStore.",
        }),
      );
    }

    try {
      const client = createClient({ url: this.url });
      this.attachClientLifecycleHandlers(client);

      await client.connect();
      this.client = client;
      this.clientPromise = null;
      return client;
    } catch (error) {
      this.clientPromise = null;
      throw error;
    }
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
    if (!this.client) return;
    await this.client.disconnect();
    this.clearCachedClient();
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
