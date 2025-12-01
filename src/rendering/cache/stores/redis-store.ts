import type { CachePayload, CacheStore } from "../types.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string | null>;
  del(key: string): Promise<number>;
  scan(cursor: number, options?: { MATCH?: string; COUNT?: number }): Promise<[number, string[]]>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface RedisCacheStoreOptions {
  url?: string;
  keyPrefix?: string;
}

export class RedisCacheStore implements CacheStore {
  private client: RedisClient | null = null;
  private readonly url?: string;
  private readonly keyPrefix: string;

  constructor(options: RedisCacheStoreOptions = {}) {
    this.url = options.url;
    this.keyPrefix = options.keyPrefix ?? "veryfront:render:";
  }

  private async ensureClient(): Promise<RedisClient> {
    if (this.client) {
      return this.client;
    }

    let createClient: ((options: { url?: string }) => RedisClient) | undefined;
    try {
      const mod = await import("npm:@redis/client@1.5.8");
      createClient = mod.createClient as unknown as (options: { url?: string }) => RedisClient;
    } catch {
      throw toError(createError({
        type: "render",
        message:
          "Redis cache store requires npm:@redis/client. Install dependencies or switch cache.render.type to 'memory' or 'filesystem'.",
      }));
    }

    const client = createClient({ url: this.url });
    if (typeof client?.on === "function") {
      client.on("error", (err: unknown) => {
        logger.error("[redis] client error", err);
      });
    }

    await client.connect();
    this.client = client;
    return client;
  }

  private storageKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get(key: string): Promise<CachePayload | undefined> {
    const client = await this.ensureClient();
    const raw = await client.get(this.storageKey(key));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as CachePayload;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: CachePayload): Promise<void> {
    const client = await this.ensureClient();
    await client.set(this.storageKey(key), JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    const client = await this.ensureClient();
    await client.del(this.storageKey(key));
  }

  async clear(): Promise<void> {
    const client = await this.ensureClient();
    let cursor = 0;
    do {
      const [nextCursor, keys] = await client.scan(cursor, {
        MATCH: `${this.keyPrefix}*`,
        COUNT: 50,
      });
      cursor = nextCursor;
      if (keys.length > 0) {
        for (const key of keys) {
          await client.del(key);
        }
      }
    } while (cursor !== 0);
  }

  async destroy(): Promise<void> {
    if (!this.client) return;
    await this.client.disconnect();
    this.client = null;
  }
}
