import { createError, isVeryfrontError, TIMEOUT_ERROR, toError } from "veryfront/errors";
import { serverLogger } from "veryfront/utils/logger";
import { ClientClosedError, createClient } from "redis";
import {
  MAX_TIMER_DELAY_MS,
  type RateLimitEntry,
  type RateLimitStore,
  REDIS_RATE_LIMIT_INCREMENT_WITH_TTL_SCRIPT,
  requireRateLimitKey,
  requireRateLimitWindowMs,
  unrefTimer,
} from "veryfront/extensions/distributed/rate-limit-support";

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

interface RedisClientFactoryOptions {
  url?: string;
  socket: {
    connectTimeout: number;
    reconnectStrategy: false;
  };
}

type RedisClientFactory = (options: RedisClientFactoryOptions) => RedisClient;

const DEFAULT_REDIS_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_REDIS_OPERATION_TIMEOUT_MS = 5_000;

/** Options accepted by redis rate limit. */
export interface RedisRateLimitOptions {
  url?: string;
  keyPrefix?: string;
  /** Maximum time allowed for loading and connecting the Redis client. */
  connectTimeoutMs?: number;
  /** Maximum time allowed for an individual Redis command. */
  operationTimeoutMs?: number;
}

/** Implement redis rate limit store. */
export class RedisRateLimitStore implements RateLimitStore {
  private client: RedisClient | null = null;
  private connectingClient: RedisClient | null = null;
  private clientPromise: Promise<RedisClient> | null = null;
  private cancelPendingConnection: (() => void) | null = null;
  private clientGeneration = 0;
  private readonly disconnectPromises = new WeakMap<RedisClient, Promise<void>>();
  private readonly disconnectedClients = new WeakSet<RedisClient>();
  private readonly pendingDisconnectClients = new Set<RedisClient>();
  private readonly reportedClientErrors = new WeakSet<RedisClient>();
  private readonly url?: string;
  private readonly keyPrefix: string;
  private readonly connectTimeoutMs: number;
  private readonly operationTimeoutMs: number;

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
    this.url = options.url;
    this.connectTimeoutMs = requireTimeoutMs(
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
  }

  private ensureClient(): Promise<RedisClient> {
    if (this.client) return Promise.resolve(this.client);
    if (this.clientPromise) return this.clientPromise;

    const generation = this.clientGeneration;
    const pending = this.connectClient(generation).finally(() => {
      if (this.clientPromise === pending) this.clientPromise = null;
    });
    this.clientPromise = pending;
    return pending;
  }

  private invalidateClient(
    client: RedisClient,
    generation: number,
    disconnect: boolean,
  ): void {
    if (generation !== this.clientGeneration) return;
    if (this.client !== client) return;

    this.clientGeneration++;
    this.client = null;
    this.clientPromise = null;

    if (disconnect) {
      void this.disconnectBestEffort(client);
    }
  }

  private attachClientLifecycleHandlers(
    client: RedisClient,
    generation = this.clientGeneration,
  ): void {
    client.on?.("error", (err: unknown) => {
      if (generation !== this.clientGeneration) return;
      if (!this.reportedClientErrors.has(client)) {
        this.reportedClientErrors.add(client);
        logger.error("client error", {
          errorName: err instanceof Error ? err.name : typeof err,
        });
      }
      this.invalidateClient(client, generation, true);
    });

    client.on?.("end", () => {
      this.invalidateClient(client, generation, false);
    });
  }

  private async loadClientFactory(): Promise<RedisClientFactory> {
    return createClient as unknown as RedisClientFactory;
  }

  private async disconnectBestEffort(client: RedisClient): Promise<void> {
    try {
      await this.disconnectClient(client);
    } catch (error) {
      if (isAlreadyClosedClientError(error)) {
        this.markDisconnected(client);
        return;
      }
      logger.warn("client disconnect failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  private disconnectClient(client: RedisClient): Promise<void> {
    if (this.disconnectedClients.has(client)) return Promise.resolve();
    const existing = this.disconnectPromises.get(client);
    if (existing) return existing;

    let resolveDisconnect!: () => void;
    let rejectDisconnect!: (reason: unknown) => void;
    const pending = new Promise<void>((resolve, reject) => {
      resolveDisconnect = resolve;
      rejectDisconnect = reject;
    });
    this.disconnectPromises.set(client, pending);
    this.pendingDisconnectClients.add(client);

    try {
      Promise.resolve(client.disconnect()).then(
        () => {
          this.markDisconnected(client);
          resolveDisconnect();
        },
        (error) => {
          this.disconnectPromises.delete(client);
          if (isAlreadyClosedClientError(error)) {
            this.markDisconnected(client);
            resolveDisconnect();
            return;
          }
          rejectDisconnect(error);
        },
      );
    } catch (error) {
      this.disconnectPromises.delete(client);
      if (isAlreadyClosedClientError(error)) {
        this.markDisconnected(client);
        resolveDisconnect();
      } else {
        rejectDisconnect(error);
      }
    }

    return pending;
  }

  private markDisconnected(client: RedisClient): void {
    this.disconnectPromises.delete(client);
    this.pendingDisconnectClients.delete(client);
    this.disconnectedClients.add(client);
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    operationName: string,
    cancellation?: Promise<never>,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(createTimeoutError(operationName, timeoutMs));
      }, timeoutMs);
      unrefTimer(timeoutId);
    });

    try {
      return await Promise.race(
        cancellation === undefined ? [operation, timeout] : [operation, timeout, cancellation],
      );
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  private async connectClient(generation: number): Promise<RedisClient> {
    const superseded = new Error(
      "Redis rate limit client connection was superseded",
    );
    superseded.name = "AbortError";
    let cancelConnection!: () => void;
    let cancelled = false;
    const cancellation = new Promise<never>((_, reject) => {
      cancelConnection = () => {
        if (cancelled) return;
        cancelled = true;
        reject(superseded);
      };
    });
    this.cancelPendingConnection = cancelConnection;

    let client: RedisClient | undefined;
    try {
      const createClient = await this.withTimeout(
        this.loadClientFactory(),
        this.connectTimeoutMs,
        "client loading",
        cancellation,
      );
      if (generation !== this.clientGeneration) throw superseded;

      client = createClient({
        ...(this.url === undefined ? {} : { url: this.url }),
        socket: {
          connectTimeout: this.connectTimeoutMs,
          reconnectStrategy: false,
        },
      });
      this.connectingClient = client;
      this.attachClientLifecycleHandlers(client, generation);
      await this.withTimeout(
        client.connect(),
        this.connectTimeoutMs,
        "connection",
        cancellation,
      );

      if (this.connectingClient === client) this.connectingClient = null;
      if (generation !== this.clientGeneration) {
        await this.disconnectBestEffort(client);
        throw superseded;
      }

      this.client = client;
      return client;
    } catch (error) {
      if (client && this.connectingClient === client) {
        this.connectingClient = null;
      }
      if (generation === this.clientGeneration) this.clientGeneration++;
      if (client) await this.disconnectBestEffort(client);
      throw error;
    } finally {
      if (this.cancelPendingConnection === cancelConnection) {
        this.cancelPendingConnection = null;
      }
    }
  }

  private storageKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const normalizedKey = requireRateLimitKey(key);
    const normalizedWindowMs = requireRateLimitWindowMs(windowMs);
    const client = await this.ensureClient();
    const generation = this.clientGeneration;
    const redisKey = this.storageKey(normalizedKey);

    let result: unknown;
    try {
      result = await this.withTimeout(
        client.eval(REDIS_RATE_LIMIT_INCREMENT_WITH_TTL_SCRIPT, {
          keys: [redisKey],
          arguments: [String(normalizedWindowMs)],
        }),
        this.operationTimeoutMs,
        "increment",
      );
    } catch (error) {
      if (isTimeoutError(error)) {
        this.invalidateClient(client, generation, true);
      }
      throw error;
    }

    const [count, pttl] = parseIncrementResult(result);
    const ttl = pttl > 0 ? requireRateLimitWindowMs(pttl) : normalizedWindowMs;
    return { count, resetAt: Date.now() + ttl };
  }

  async reset(key: string): Promise<void> {
    const normalizedKey = requireRateLimitKey(key);
    const client = await this.ensureClient();
    const generation = this.clientGeneration;
    try {
      await this.withTimeout(
        client.del(this.storageKey(normalizedKey)),
        this.operationTimeoutMs,
        "reset",
      );
    } catch (error) {
      if (isTimeoutError(error)) {
        this.invalidateClient(client, generation, true);
      }
      throw error;
    }
  }

  async destroy(): Promise<void> {
    const client = this.client;
    const connectingClient = this.connectingClient;
    const pending = this.clientPromise;
    // Mark the pending connection rejection as observed before cancellation;
    // disconnect work below may otherwise leave an unhandled-rejection window.
    pending?.catch(() => {});
    const cancelPendingConnection = this.cancelPendingConnection;
    const clientsToDisconnect = new Set(this.pendingDisconnectClients);
    if (client) clientsToDisconnect.add(client);
    if (connectingClient) clientsToDisconnect.add(connectingClient);
    this.clientGeneration++;
    this.client = null;
    this.connectingClient = null;
    this.clientPromise = null;
    this.cancelPendingConnection = null;
    cancelPendingConnection?.();

    let disconnectFailed = false;
    let disconnectError: unknown;
    await Promise.all(
      [...clientsToDisconnect].map((clientToDisconnect) =>
        this.disconnectClient(clientToDisconnect).catch((error: unknown) => {
          disconnectFailed = true;
          disconnectError ??= error;
        })
      ),
    );
    if (disconnectFailed) throw disconnectError;
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

function isAlreadyClosedClientError(error: unknown): boolean {
  return error instanceof ClientClosedError;
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
