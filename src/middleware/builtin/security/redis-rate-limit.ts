import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import { serverLogger as logger } from "@veryfront/utils";
import type { RateLimitEntry, RateLimitStore } from "./types.ts";

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
  private readonly url?: string;
  private readonly keyPrefix: string;

  constructor(options: RedisRateLimitOptions = {}) {
    this.url = options.url;
    this.keyPrefix = options.keyPrefix ?? "veryfront:ratelimit:";
  }

  private async ensureClient(): Promise<RedisClient> {
    if (this.client) {
      return this.client;
    }

    let createClient: ((options: { url?: string }) => RedisClient) | undefined;
    try {
      const redisClientModule = ["npm:@redis/client", "@1.5.8"].join("");
      const mod = await import(redisClientModule);
      createClient = mod.createClient as unknown as (options: { url?: string }) => RedisClient;
    } catch {
      throw toError(createError({
        type: "config",
        message:
          "Redis rate limit store requires npm:@redis/client. Install dependencies or use MemoryRateLimitStore.",
      }));
    }

    const client = createClient({ url: this.url });
    if (typeof client?.on === "function") {
      client.on("error", (err: unknown) => {
        logger.error("[redis-ratelimit] client error", err);
      });
    }

    await client.connect();
    this.client = client;
    return client;
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
      return {
        count,
        resetAt: Date.now() + windowMs,
      };
    }


    const ttl = pttl > 0 ? pttl : windowMs;

    return {
      count,
      resetAt: Date.now() + ttl,
    };
  }

  async reset(key: string): Promise<void> {
    const client = await this.ensureClient();
    await client.del(this.storageKey(key));
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }
}
