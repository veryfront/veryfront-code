import { createError, isVeryfrontError, TIMEOUT_ERROR, toError } from "#veryfront/errors";
import { OwnedRedisClientConnection } from "#veryfront/extensions/distributed/owned-redis-client.ts";
import type { RedisClient } from "#veryfront/extensions/distributed";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { serverLogger } from "#veryfront/utils";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { REDIS_RATE_LIMIT_INCREMENT_WITH_TTL_SCRIPT } from "./redis-rate-limit-script.ts";
import { requireRateLimitKey, requireRateLimitWindowMs } from "./rate-limit-validation.ts";
import type { RateLimitEntry, RateLimitStore } from "./types.ts";

const logger = serverLogger.component("redis-ratelimit");
const DEFAULT_REDIS_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_REDIS_OPERATION_TIMEOUT_MS = 5_000;

/** Options accepted by the provider-backed Redis rate-limit store. */
export interface RedisRateLimitOptions {
  url?: string;
  keyPrefix?: string;
  /** Maximum time allowed for opening the extension-provided Redis client. */
  connectTimeoutMs?: number;
  /** Maximum time allowed for an individual Redis command. */
  operationTimeoutMs?: number;
}

/**
 * Redis rate-limit store backed by the registered Redis runtime provider.
 *
 * Core owns only the stable rate-limit facade. The Redis extension owns the
 * third-party client package, connections, and transport lifecycle.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly connection: OwnedRedisClientConnection;
  private readonly keyPrefix: string;
  private readonly operationTimeoutMs: number;

  constructor(options: RedisRateLimitOptions = {}) {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw new TypeError("Redis rate limit options must be an object");
    }
    if (options.url !== undefined && typeof options.url !== "string") {
      throw new TypeError("Redis rate limit url must be a string");
    }
    const connectTimeoutMs = requireTimeoutMs(
      options.connectTimeoutMs ?? DEFAULT_REDIS_CONNECT_TIMEOUT_MS,
      "connectTimeoutMs",
    );
    this.operationTimeoutMs = requireTimeoutMs(
      options.operationTimeoutMs ?? DEFAULT_REDIS_OPERATION_TIMEOUT_MS,
      "operationTimeoutMs",
    );
    this.keyPrefix = requireRateLimitKey(
      options.keyPrefix ?? "veryfront:ratelimit:",
      "Redis rate limit keyPrefix",
    );
    this.connection = new OwnedRedisClientConnection(
      {
        ...(options.url === undefined ? {} : { url: options.url }),
        connectTimeout: connectTimeoutMs,
        autoReconnect: false,
      },
      {
        onError(error) {
          logger.error("client error", {
            errorName: error instanceof Error ? error.name : typeof error,
          });
        },
        onCloseError(error) {
          logger.error("client close failed", {
            errorName: error instanceof Error ? error.name : typeof error,
          });
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

  private async withOperationTimeout<T>(
    operation: Promise<T>,
    operationName: string,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(createTimeoutError(operationName, this.operationTimeoutMs)),
        this.operationTimeoutMs,
      );
      unrefTimer(timeoutId);
    });

    try {
      return await Promise.race([operation, timeout]);
    } catch (error) {
      if (isTimeoutError(error)) {
        // Retire the timed-out provider-owned connection before another
        // operation can reuse it. A close failure stays observable on the next
        // getClient()/destroy() attempt instead of silently reopening.
        void this.connection.close().catch((closeError) => {
          logger.error("timed-out client close failed", {
            errorName: closeError instanceof Error ? closeError.name : typeof closeError,
          });
        });
      }
      throw error;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const normalizedKey = requireRateLimitKey(key);
    const normalizedWindowMs = requireRateLimitWindowMs(windowMs);
    const client = await this.ensureClient();
    const redisKey = this.storageKey(normalizedKey);

    const [count, pttl] = parseIncrementResult(
      await this.withOperationTimeout(
        client.eval(REDIS_RATE_LIMIT_INCREMENT_WITH_TTL_SCRIPT, {
          keys: [redisKey],
          arguments: [String(normalizedWindowMs)],
        }),
        "increment",
      ),
    );
    const ttl = pttl > 0 ? requireRateLimitWindowMs(pttl) : normalizedWindowMs;
    return { count, resetAt: Date.now() + ttl };
  }

  async reset(key: string): Promise<void> {
    const normalizedKey = requireRateLimitKey(key);
    const client = await this.ensureClient();
    await this.withOperationTimeout(
      client.del(this.storageKey(normalizedKey)).then(() => undefined),
      "reset",
    );
  }

  async destroy(): Promise<void> {
    await this.connection.close();
  }
}

function requireTimeoutMs(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Redis rate limit ${name} must be an integer between 1 and ${MAX_TIMER_DELAY_MS}`,
    );
  }
  return value;
}

function createTimeoutError(operationName: string, timeoutMs: number): Error {
  return TIMEOUT_ERROR.create({
    detail: `Redis rate limit ${operationName} timed out after ${timeoutMs}ms`,
  });
}

function isTimeoutError(error: unknown): boolean {
  return isVeryfrontError(error) && error.slug === TIMEOUT_ERROR.slug;
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

  if (!Number.isSafeInteger(count) || count < 1) {
    throw toError(
      createError({
        type: "config",
        message: "Redis rate limit eval returned an invalid count.",
      }),
    );
  }
  if (!Number.isSafeInteger(ttl)) {
    throw toError(
      createError({
        type: "config",
        message: "Redis rate limit eval returned an invalid TTL.",
      }),
    );
  }

  return [count, ttl];
}
