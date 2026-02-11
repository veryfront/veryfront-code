import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { serverLogger } from "#veryfront/utils";
import type { RateLimitEntry, RateLimitStore } from "./types.ts";

const logger = serverLogger.component("redis-ratelimit");

interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  incr(key: string): Promise<number>;
  pExpire(key: string, milliseconds: number): Promise<boolean>;
  pTTL(key: string): Promise<number>;
  del(key: string): Promise<number>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface RedisRateLimitOptions {
  url?: string;
  keyPrefix?: string;
}

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

  private async connectClient(): Promise<RedisClient> {
    let createClient: (options: { url?: string }) => RedisClient;

    try {
      const redisClientModule = ["npm:@redis/client", "@1.5.8"].join("");
      const mod = await import(redisClientModule);
      createClient = mod.createClient as (options: { url?: string }) => RedisClient;
    } catch {
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

      client.on?.("error", (err: unknown) => {
        logger.error("client error", err);
      });

      await client.connect();
      this.client = client;
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

    const count = await client.incr(redisKey);

    if (count === 1) {
      await client.pExpire(redisKey, windowMs);
    }

    const pttl = await client.pTTL(redisKey);

    if (pttl === -1) {
      await client.pExpire(redisKey, windowMs);
      return { count, resetAt: Date.now() + windowMs };
    }

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
    this.client = null;
  }
}
