import type { RateLimitStore } from "./types.ts";
import { requireRateLimitKey } from "./rate-limit-validation.ts";

const DEFAULT_REDIS_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_REDIS_OPERATION_TIMEOUT_MS = 5_000;

/** Options accepted by Redis rate limit. */
export interface RedisRateLimitOptions {
  url?: string;
  keyPrefix?: string;
  /** Maximum time allowed for loading and connecting the Redis client. */
  connectTimeoutMs?: number;
  /** Maximum time allowed for an individual Redis command. */
  operationTimeoutMs?: number;
}

type RedisRateLimitStoreDelegate = RateLimitStore & {
  destroy?: () => void | Promise<void>;
};

interface RedisRateLimitStoreModule {
  RedisRateLimitStore: new (
    options?: RedisRateLimitOptions,
  ) => RedisRateLimitStoreDelegate;
}

/** Create a Redis rate limit store backed by @veryfront/ext-redis. */
export class RedisRateLimitStore implements RateLimitStore {
  private delegate: RedisRateLimitStoreDelegate | undefined;
  private readonly options: RedisRateLimitOptions;

  constructor(options: RedisRateLimitOptions = {}) {
    if (
      typeof options !== "object" ||
      options === null ||
      Array.isArray(options)
    ) {
      throw new TypeError("Redis rate limit options must be an object");
    }
    if (options.url !== undefined && typeof options.url !== "string") {
      throw new TypeError("Redis rate limit url must be a string");
    }
    if (options.keyPrefix !== undefined) {
      requireRateLimitKey(options.keyPrefix, "Redis rate limit keyPrefix");
    }
    requireTimeoutMs(
      options.connectTimeoutMs ?? DEFAULT_REDIS_CONNECT_TIMEOUT_MS,
      "connectTimeoutMs",
    );
    requireTimeoutMs(
      options.operationTimeoutMs ?? DEFAULT_REDIS_OPERATION_TIMEOUT_MS,
      "operationTimeoutMs",
    );
    this.options = { ...options };
  }

  async increment(key: string, windowMs: number) {
    return await (await this.getDelegate()).increment(key, windowMs);
  }

  async reset(key: string): Promise<void> {
    await (await this.getDelegate()).reset(key);
  }

  async destroy(): Promise<void> {
    await this.delegate?.destroy?.();
    this.delegate = undefined;
  }

  private async getDelegate(): Promise<RedisRateLimitStoreDelegate> {
    if (this.delegate) return this.delegate;
    const module = await import("@veryfront/ext-redis") as RedisRateLimitStoreModule;
    this.delegate = new module.RedisRateLimitStore(this.options);
    return this.delegate;
  }
}

function requireTimeoutMs(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new RangeError(`Redis rate limit ${name} must be a positive safe integer`);
  }
  return value;
}
