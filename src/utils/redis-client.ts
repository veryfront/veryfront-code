import { getEnv } from "#veryfront/platform/compat/process.ts";
import { logger as baseLogger } from "./logger/logger.ts";
import { DEPENDENCY_MISSING, INITIALIZATION_ERROR } from "#veryfront/errors";

const logger = baseLogger.component("redis");

export interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  get(key: string): Promise<string | null>;
  mGet(keys: string[]): Promise<Array<string | null>>;
  set(key: string, value: string, options?: { EX?: number }): Promise<string | null>;
  del(key: string | string[]): Promise<number>;
  scan(
    cursor: number,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: number; keys: string[] }>;
  expire(key: string, seconds: number): Promise<number>;
  ttl?(key: string): Promise<number>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  isOpen?: boolean;
}

export interface RedisClientOptions {
  url?: string;
  connectTimeout?: number;
  autoReconnect?: boolean;
  tls?: boolean;
  password?: string;
  username?: string;
}

/** Minimal `@redis/client` factory options used by this module. */
export interface RedisClientFactoryOptions {
  url?: string;
  socket?: {
    tls?: boolean;
    connectTimeout?: number;
    reconnectStrategy?: false;
  };
  password?: string;
  username?: string;
}

type RedisClientFactory = (options: RedisClientFactoryOptions) => RedisClient;

export interface RedisClientManagerDependencies {
  getEnv?: (key: string) => string | undefined;
  loadFactory?: () => Promise<RedisClientFactory>;
  now?: () => number;
}

export interface RedisClientManager {
  getClient(options?: RedisClientOptions): Promise<RedisClient>;
  disconnect(): Promise<void>;
  isConfigured(): boolean;
}

interface ResolvedRedisClientOptions {
  factoryOptions: RedisClientFactoryOptions;
  key: string;
  useTls: boolean;
}

interface ConnectionState {
  client?: RedisClient;
  provisionalClient?: RedisClient;
  connecting?: Promise<RedisClient>;
  cancelConnecting?: () => void;
  failedAt?: number;
  generation: number;
}

const RECONNECT_DELAY_MS = 5_000;

function connectionCancelledError(): Error {
  return INITIALIZATION_ERROR.create({
    detail: "[Redis] Connection attempt cancelled by disconnect",
  });
}

function resolveClientOptions(
  options: RedisClientOptions,
  readEnv: (key: string) => string | undefined,
): ResolvedRedisClientOptions {
  if (
    options.connectTimeout !== undefined &&
    (!Number.isInteger(options.connectTimeout) || options.connectTimeout <= 0)
  ) {
    throw new RangeError("Redis connectTimeout must be a positive integer");
  }

  const url = options.url ?? readEnv("REDIS_URL");
  const useTls = options.tls ?? url?.startsWith("rediss://") ?? false;
  const password = options.password ?? readEnv("REDIS_PASSWORD");
  const username = options.username ?? readEnv("REDIS_USERNAME");
  const socket = useTls || options.connectTimeout !== undefined || options.autoReconnect === false
    ? {
      ...(useTls ? { tls: true } : {}),
      ...(options.connectTimeout === undefined ? {} : { connectTimeout: options.connectTimeout }),
      ...(options.autoReconnect === false ? { reconnectStrategy: false as const } : {}),
    }
    : undefined;

  const factoryOptions: RedisClientFactoryOptions = {
    ...(url === undefined ? {} : { url }),
    ...(socket === undefined ? {} : { socket }),
    ...(password === undefined ? {} : { password }),
    ...(username === undefined ? {} : { username }),
  };
  const key = JSON.stringify({
    url,
    useTls,
    connectTimeout: options.connectTimeout,
    autoReconnect: options.autoReconnect ?? true,
    password,
    username,
  });

  return { factoryOptions, key, useTls };
}

async function loadDefaultFactory(): Promise<RedisClientFactory> {
  try {
    const redisClientModule = "npm:@redis/client@1.5.8";
    const mod = await import(redisClientModule);
    return mod.createClient as RedisClientFactory;
  } catch (error) {
    logger.debug("Failed to load @redis/client module", { error });
    throw DEPENDENCY_MISSING.create({
      detail:
        "[Redis] Failed to load @redis/client. Install with: deno add npm:@redis/client@1.5.8",
    });
  }
}

async function disconnectClient(client: RedisClient): Promise<void> {
  try {
    await client.disconnect();
  } catch (error) {
    logger.debug("Error during disconnect", { error });
  }
}

export function createRedisClientManager(
  dependencies: RedisClientManagerDependencies = {},
): RedisClientManager {
  const readEnv = dependencies.getEnv ?? getEnv;
  const loadFactory = dependencies.loadFactory ?? loadDefaultFactory;
  const now = dependencies.now ?? Date.now;

  const states = new Map<string, ConnectionState>();
  const clientDisconnections = new WeakMap<RedisClient, Promise<void>>();
  let disconnectVersion = 0;
  let disconnecting: Promise<void> | null = null;

  function disconnectTrackedClient(client: RedisClient): Promise<void> {
    const existing = clientDisconnections.get(client);
    if (existing) return existing;

    const pending = disconnectClient(client);
    const tracked = pending.finally(() => {
      if (clientDisconnections.get(client) === tracked) {
        clientDisconnections.delete(client);
      }
    });
    clientDisconnections.set(client, tracked);
    return tracked;
  }

  function sweepExpiredFailures(): void {
    const currentTime = now();
    for (const [key, state] of states) {
      if (
        !state.client && !state.connecting && state.failedAt !== undefined &&
        currentTime - state.failedAt >= RECONNECT_DELAY_MS
      ) {
        states.delete(key);
      }
    }
  }

  function getClient(options: RedisClientOptions = {}): Promise<RedisClient> {
    if (disconnecting) {
      const queuedOptions = { ...options };
      return disconnecting.then(() => getClient(queuedOptions));
    }

    let resolved: ResolvedRedisClientOptions;
    try {
      resolved = resolveClientOptions(options, readEnv);
    } catch (error) {
      return Promise.reject(error);
    }

    sweepExpiredFailures();
    let state = states.get(resolved.key);
    if (state?.client && state.client.isOpen !== false && state.failedAt === undefined) {
      return Promise.resolve(state.client);
    }
    if (state?.connecting) return state.connecting;
    if (state?.failedAt !== undefined && now() - state.failedAt < RECONNECT_DELAY_MS) {
      return Promise.reject(
        INITIALIZATION_ERROR.create({
          detail: "[Redis] Connection recently failed, waiting before retry",
        }),
      );
    }

    if (!state) {
      state = { generation: 0 };
      states.set(resolved.key, state);
    }
    const connectionState = state;
    const stale = connectionState.client;
    connectionState.client = undefined;
    const attemptGeneration = ++connectionState.generation;
    const attemptDisconnectVersion = disconnectVersion;
    const cancellationError = connectionCancelledError();
    let cancelled = false;
    let rejectCancellation: ((reason: Error) => void) | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    connectionState.cancelConnecting = () => {
      if (cancelled) return;
      cancelled = true;
      rejectCancellation?.(cancellationError);
    };
    const trackedPromise: Promise<RedisClient> = (async () => {
      if (stale) {
        connectionState.provisionalClient = stale;
        try {
          await Promise.race([disconnectTrackedClient(stale), cancellation]);
        } finally {
          if (connectionState.provisionalClient === stale) {
            connectionState.provisionalClient = undefined;
          }
        }
      }

      if (!resolved.useTls && readEnv("NODE_ENV") === "production") {
        logger.warn(
          "Redis connection without TLS in production. Set REDIS_URL to rediss:// or pass tls: true.",
        );
      }

      const factory = await Promise.race([loadFactory(), cancellation]);
      if (
        states.get(resolved.key) !== connectionState ||
        connectionState.generation !== attemptGeneration ||
        disconnectVersion !== attemptDisconnectVersion
      ) {
        throw connectionCancelledError();
      }
      const client = factory(resolved.factoryOptions);
      connectionState.provisionalClient = client;

      if (typeof client.on === "function") {
        client.on("error", (error: unknown) => {
          if (
            states.get(resolved.key) !== connectionState ||
            connectionState.client !== client ||
            connectionState.generation !== attemptGeneration
          ) return;
          logger.error("Client error", error);
          connectionState.failedAt = now();
        });
        client.on("reconnecting", () => {
          if (
            states.get(resolved.key) === connectionState &&
            connectionState.client === client &&
            connectionState.generation === attemptGeneration
          ) {
            logger.info("Reconnecting...");
          }
        });
        client.on("ready", () => {
          if (
            states.get(resolved.key) !== connectionState ||
            connectionState.client !== client ||
            connectionState.generation !== attemptGeneration
          ) return;
          logger.info("Ready");
          connectionState.failedAt = undefined;
        });
      }

      try {
        await Promise.race([client.connect(), cancellation]);
      } catch (error) {
        await disconnectTrackedClient(client);
        if (connectionState.provisionalClient === client) {
          connectionState.provisionalClient = undefined;
        }
        throw error;
      }
      if (
        states.get(resolved.key) !== connectionState ||
        connectionState.generation !== attemptGeneration ||
        disconnectVersion !== attemptDisconnectVersion
      ) {
        await disconnectTrackedClient(client);
        if (connectionState.provisionalClient === client) {
          connectionState.provisionalClient = undefined;
        }
        throw connectionCancelledError();
      }

      connectionState.provisionalClient = undefined;
      connectionState.client = client;
      connectionState.failedAt = undefined;
      logger.info("Connected successfully");
      return client;
    })()
      .catch((error) => {
        if (
          states.get(resolved.key) === connectionState &&
          connectionState.generation === attemptGeneration
        ) {
          connectionState.failedAt = now();
          connectionState.client = undefined;
        }
        throw error;
      })
      .finally(() => {
        if (connectionState.connecting === trackedPromise) {
          connectionState.connecting = undefined;
          connectionState.cancelConnecting = undefined;
        }
      });

    connectionState.connecting = trackedPromise;
    return trackedPromise;
  }

  function disconnect(): Promise<void> {
    if (disconnecting) return disconnecting;

    disconnectVersion++;
    const clients = new Set<RedisClient>();
    for (const state of states.values()) {
      state.generation++;
      state.cancelConnecting?.();
      if (state.client) clients.add(state.client);
      if (state.provisionalClient) clients.add(state.provisionalClient);
      state.client = undefined;
      state.provisionalClient = undefined;
    }
    states.clear();

    const pending = Promise.all([...clients].map(disconnectTrackedClient)).then(() => undefined);
    const tracked = pending.finally(() => {
      if (disconnecting === tracked) disconnecting = null;
    });
    disconnecting = tracked;
    return tracked;
  }

  function isConfigured(): boolean {
    return Boolean(readEnv("REDIS_URL"));
  }

  return { getClient, disconnect, isConfigured };
}

const defaultManager = createRedisClientManager();

export function getRedisClient(options: RedisClientOptions = {}): Promise<RedisClient> {
  return defaultManager.getClient(options);
}

/** Disconnect and clear the shared client so the next call reconnects fresh. */
export function disconnectRedisClient(): Promise<void> {
  return defaultManager.disconnect();
}

export function isRedisConfigured(): boolean {
  return defaultManager.isConfigured();
}
