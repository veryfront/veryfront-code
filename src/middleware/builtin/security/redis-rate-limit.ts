import { createError, toError } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { serverLogger } from "#veryfront/utils";
import { calculateRateLimitResetAt, type RateLimitEntry, type RateLimitStore } from "./types.ts";

const logger = serverLogger.component("redis-ratelimit");
const MAX_KEY_PREFIX_LENGTH = 256;
const MAX_STORAGE_KEY_LENGTH = 1_024;
const MAX_REDIS_URL_LENGTH = 2_048;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;
const REDIS_CLIENT_SPECIFIER = "npm:@redis/client@1.5.8";

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizeRedisUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_REDIS_URL_LENGTH || hasControlCharacters(value)
  ) {
    throw new TypeError(
      `url must be a Redis URL no longer than ${MAX_REDIS_URL_LENGTH} characters`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("url must be a valid redis: or rediss: URL");
  }
  if ((parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") || !parsed.hostname) {
    throw new TypeError("url must be a valid redis: or rediss: URL");
  }
  return value;
}

function normalizeTimeout(name: string, value: unknown, fallback: number): number {
  const timeout = value ?? fallback;
  if (
    typeof timeout !== "number" || !Number.isSafeInteger(timeout) || timeout < 1 ||
    timeout > MAX_TIMEOUT_MS
  ) {
    throw new TypeError(`${name} must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }
  return timeout;
}

class RedisRateLimitTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs} ms`);
    this.name = "RedisRateLimitTimeoutError";
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  operationName: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new RedisRateLimitTimeoutError(operationName, timeoutMs)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

interface RedisClientFactoryOptions {
  url?: string;
  socket: {
    connectTimeout: number;
    reconnectStrategy: false;
  };
}

interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
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

/** Options for Redis-backed rate limiting. */
export interface RedisRateLimitOptions {
  /** Redis connection URL using the redis: or rediss: scheme. Defaults to REDIS_URL. */
  url?: string;
  /** Prefix added to rate-limit keys. */
  keyPrefix?: string;
  /** Connection deadline in milliseconds. Defaults to 10000. */
  connectTimeoutMs?: number;
  /** Command and disconnect deadline in milliseconds. Defaults to 10000. */
  operationTimeoutMs?: number;
}

/** Store rate-limit counters in Redis with atomic increments and expirations. */
export class RedisRateLimitStore implements RateLimitStore {
  private client: RedisClient | null = null;
  private clientPromise: Promise<RedisClient> | null = null;
  private destroyed = false;
  private readonly url?: string;
  private readonly keyPrefix: string;
  private readonly connectTimeoutMs: number;
  private readonly operationTimeoutMs: number;

  /** Create a lazily connected Redis rate-limit store. */
  constructor(options: RedisRateLimitOptions = {}) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Redis rate limit options must be an object");
    }
    this.url = normalizeRedisUrl(options.url ?? getHostEnv("REDIS_URL"));
    if (this.url === undefined && getHostEnv("NODE_ENV") === "production") {
      throw new TypeError(
        "Redis rate limit url or REDIS_URL is required in production",
      );
    }
    this.connectTimeoutMs = normalizeTimeout(
      "connectTimeoutMs",
      options.connectTimeoutMs,
      DEFAULT_CONNECT_TIMEOUT_MS,
    );
    this.operationTimeoutMs = normalizeTimeout(
      "operationTimeoutMs",
      options.operationTimeoutMs,
      DEFAULT_OPERATION_TIMEOUT_MS,
    );
    this.keyPrefix = options.keyPrefix ?? "veryfront:ratelimit:";
    if (
      typeof this.keyPrefix !== "string" || this.keyPrefix.length === 0 ||
      this.keyPrefix.length > MAX_KEY_PREFIX_LENGTH ||
      hasControlCharacters(this.keyPrefix)
    ) {
      throw new TypeError(
        `keyPrefix must contain 1 to ${MAX_KEY_PREFIX_LENGTH} characters without control characters`,
      );
    }
  }

  /** Return the active client or establish one shared connection. */
  private ensureClient(): Promise<RedisClient> {
    if (this.destroyed) {
      return Promise.reject(new Error("RedisRateLimitStore has been destroyed"));
    }
    if (this.client) return Promise.resolve(this.client);
    this.clientPromise ??= this.connectClient();
    return this.clientPromise;
  }

  /** Remove cached connection state after a terminal client event. */
  private clearCachedClient(): void {
    this.client = null;
    this.clientPromise = null;
  }

  /** Clear stale cached state when the Redis client emits lifecycle events. */
  private attachClientLifecycleHandlers(client: RedisClient): void {
    client.on?.("error", (err: unknown) => {
      logger.error("client error", {
        errorName: err instanceof Error ? err.name : typeof err,
      });
      if (this.client === client) {
        this.clearCachedClient();
        void this.disconnectClientQuietly(client);
      }
    });

    client.on?.("end", () => {
      if (this.client === client) this.clearCachedClient();
    });
  }

  /** Disconnect a failed client without replacing the primary operation error. */
  private async disconnectClientQuietly(client: RedisClient): Promise<void> {
    try {
      await withTimeout(
        client.disconnect(),
        this.operationTimeoutMs,
        "Redis rate limit disconnect",
      );
    } catch (error) {
      logger.warn("client disconnect failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  /** Bound a Redis command and retire its client if the deadline expires. */
  private async runOperation<T>(
    client: RedisClient,
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await withTimeout(
        Promise.resolve().then(operation),
        this.operationTimeoutMs,
        operationName,
      );
    } catch (error) {
      if (error instanceof RedisRateLimitTimeoutError && this.client === client) {
        this.clearCachedClient();
        void this.disconnectClientQuietly(client);
      }
      throw error;
    }
  }

  /** Load the optional Redis client and establish a connection. */
  private async connectClient(): Promise<RedisClient> {
    let createClient: (options: RedisClientFactoryOptions) => RedisClient;

    try {
      const mod = await import(REDIS_CLIENT_SPECIFIER);
      createClient = mod.createClient as (options: RedisClientFactoryOptions) => RedisClient;
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

    let client: RedisClient | null = null;
    try {
      client = createClient({
        url: this.url,
        socket: {
          connectTimeout: this.connectTimeoutMs,
          reconnectStrategy: false,
        },
      });
      this.attachClientLifecycleHandlers(client);

      const connection = client.connect();
      await withTimeout(
        connection,
        this.connectTimeoutMs,
        "Redis rate limit connection",
      );
      if (this.destroyed) {
        throw new Error("RedisRateLimitStore has been destroyed");
      }
      this.client = client;
      this.clientPromise = null;
      return client;
    } catch (error) {
      this.clientPromise = null;
      if (client) await this.disconnectClientQuietly(client);
      throw error;
    }
  }

  /** Validate and prefix a caller-provided rate-limit key. */
  private storageKey(key: string): string {
    if (typeof key !== "string" || key.length > MAX_STORAGE_KEY_LENGTH) {
      throw new TypeError(
        `Rate limit keys must be strings no longer than ${MAX_STORAGE_KEY_LENGTH} characters`,
      );
    }
    return `${this.keyPrefix}${key}`;
  }

  /** Atomically increment a key and return its active window state. */
  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
      throw new TypeError("windowMs must be a positive safe integer");
    }
    const client = await this.ensureClient();
    const redisKey = this.storageKey(key);

    const result = await this.runOperation(
      client,
      "Redis rate limit increment",
      () =>
        client.eval(INCREMENT_WITH_TTL_SCRIPT, {
          keys: [redisKey],
          arguments: [String(windowMs)],
        }),
    );
    const [count, pttl] = parseIncrementResult(result);
    const ttl = pttl > 0 ? pttl : windowMs;
    return { count, resetAt: calculateRateLimitResetAt(Date.now(), ttl) };
  }

  /** Remove the counter for a key. */
  async reset(key: string): Promise<void> {
    const client = await this.ensureClient();
    await this.runOperation(
      client,
      "Redis rate limit reset",
      () => client.del(this.storageKey(key)),
    );
  }

  /** Close the active or pending client connection once. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    const client = this.client;
    const pendingClient = this.clientPromise;
    this.clearCachedClient();
    const connection = client ?? await pendingClient?.catch(() => null) ?? null;
    if (connection) {
      await withTimeout(
        connection.disconnect(),
        this.operationTimeoutMs,
        "Redis rate limit disconnect",
      );
    }
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

  if (
    !Number.isSafeInteger(count) || count <= 0 ||
    !Number.isSafeInteger(ttl) || ttl <= 0
  ) {
    throw toError(
      createError({
        type: "config",
        message: "Redis rate limit eval returned an invalid result.",
      }),
    );
  }

  return [count, ttl];
}
