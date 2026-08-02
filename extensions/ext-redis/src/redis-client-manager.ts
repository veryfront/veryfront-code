import { INITIALIZATION_ERROR } from "veryfront/errors/general";
import { DEPENDENCY_MISSING } from "veryfront/errors/module";
import type { RedisClient, RedisClientOptions } from "veryfront/extensions/distributed";
export type { RedisClient, RedisClientOptions } from "veryfront/extensions/distributed";
import { getEnv } from "veryfront/platform/env";
import { logger as baseLogger } from "veryfront/utils/logger";
import { requireRedisUrl } from "./connection-config.ts";

const logger = baseLogger.component("redis");
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const RECONNECT_DELAY_MS = 5_000;
const CLIENT_OPTION_KEYS = new Set([
  "url",
  "connectTimeout",
  "autoReconnect",
  "tls",
  "password",
  "username",
]);

function logCleanupFailure(message: string, error: unknown): void {
  try {
    logger.error(message, error);
  } catch {
    // Diagnostics must not interrupt transport cleanup.
  }
}

/** Minimal `@redis/client` factory options used by this extension. */
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

export type RedisClientFactory = (options: RedisClientFactoryOptions) => RedisClient;

export interface RedisClientManagerDependencies {
  getEnv?: (key: string) => string | undefined;
  loadFactory?: () => Promise<RedisClientFactory>;
  now?: () => number;
}

export interface RedisClientOpenLifecycle {
  signal?: AbortSignal;
  onClientCreated?(client: RedisClient): (() => Promise<void>) | void;
}

export interface RedisClientManager {
  getClient(options?: RedisClientOptions): Promise<RedisClient>;
  disconnect(): Promise<void>;
  isConfigured(options?: RedisClientOptions): boolean;
}

const setupCleanupClients = new WeakMap<object, RedisClient>();

/** Setup failed and the provisional client could not be disposed. */
class RedisClientSetupCleanupError extends AggregateError {
  constructor(setupError: unknown, cleanupError: unknown, client: RedisClient) {
    super(
      [setupError, cleanupError],
      "Redis client setup and cleanup failed",
    );
    setupCleanupClients.set(this, client);
  }
}

/** Internal handoff of a provisional client that still requires cleanup. */
export function takeRedisClientSetupCleanupClient(error: unknown): RedisClient | undefined {
  if (!error || typeof error !== "object") return undefined;
  const client = setupCleanupClients.get(error);
  if (client) setupCleanupClients.delete(error);
  return client;
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

function readOwnDataProperty(value: object, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (cause) {
    throw new TypeError(`Redis client option ${key} could not be inspected`, { cause });
  }
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Redis client option ${key} must be a data property`);
  }
  return descriptor.value;
}

function captureClientOptions(value: RedisClientOptions): Readonly<RedisClientOptions> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Redis client options must be an object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw new TypeError("Redis client options could not be inspected", { cause });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Redis client options must be a plain object");
  }
  if (keys.some((key) => typeof key !== "string" || !CLIENT_OPTION_KEYS.has(key))) {
    throw new TypeError("Redis client options contain an unknown option");
  }

  const urlValue = readOwnDataProperty(value, "url");
  const connectTimeout = readOwnDataProperty(value, "connectTimeout");
  const autoReconnect = readOwnDataProperty(value, "autoReconnect");
  const tls = readOwnDataProperty(value, "tls");
  const password = readOwnDataProperty(value, "password");
  const username = readOwnDataProperty(value, "username");
  if (urlValue !== undefined) requireRedisUrl(urlValue);
  if (autoReconnect !== undefined && typeof autoReconnect !== "boolean") {
    throw new TypeError("Redis client option autoReconnect must be a boolean");
  }
  if (tls !== undefined && typeof tls !== "boolean") {
    throw new TypeError("Redis client option tls must be a boolean");
  }
  if (password !== undefined && typeof password !== "string") {
    throw new TypeError("Redis client option password must be a string");
  }
  if (username !== undefined && typeof username !== "string") {
    throw new TypeError("Redis client option username must be a string");
  }
  return Object.freeze({
    ...(urlValue === undefined ? {} : { url: urlValue as string }),
    ...(connectTimeout === undefined ? {} : { connectTimeout: connectTimeout as number }),
    ...(autoReconnect === undefined ? {} : { autoReconnect }),
    ...(tls === undefined ? {} : { tls }),
    ...(password === undefined ? {} : { password }),
    ...(username === undefined ? {} : { username }),
  });
}

function connectionCancelledError(): Error {
  return INITIALIZATION_ERROR.create({
    detail: "[Redis] Connection attempt cancelled by disconnect",
  });
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? connectionCancelledError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? connectionCancelledError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function resolveClientOptions(
  options: RedisClientOptions,
  readEnv: (key: string) => string | undefined,
): ResolvedRedisClientOptions {
  if (
    options.connectTimeout !== undefined &&
    (!Number.isInteger(options.connectTimeout) || options.connectTimeout <= 0 ||
      options.connectTimeout > MAX_TIMER_DELAY_MS)
  ) {
    throw new RangeError(
      `Redis connectTimeout must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`,
    );
  }

  const configuredUrl = options.url ?? readEnv("REDIS_URL");
  const url = configuredUrl === undefined || configuredUrl.length === 0
    ? undefined
    : requireRedisUrl(configuredUrl);
  const useTls = options.tls ?? url?.startsWith("rediss://") ?? false;
  if (!useTls && readEnv("NODE_ENV") === "production") {
    logger.warn(
      "Redis connection without TLS in production. Set REDIS_URL to rediss:// or pass tls: true.",
    );
  }

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
    const module = await import("@redis/client");
    if (typeof module.createClient !== "function") {
      throw new TypeError("@redis/client does not export createClient");
    }
    return module.createClient as unknown as RedisClientFactory;
  } catch (error) {
    logger.debug("Failed to load @redis/client module", { error });
    throw DEPENDENCY_MISSING.create({
      detail:
        "[Redis] Failed to load @redis/client from @veryfront/ext-redis. Reinstall the extension package.",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function assertRedisClient(value: unknown): asserts value is RedisClient {
  if (!value || typeof value !== "object") {
    throw new TypeError("Redis client factory must return an object");
  }
  for (
    const method of [
      "connect",
      "disconnect",
      "get",
      "mGet",
      "set",
      "del",
      "scan",
      "expire",
      "eval",
      "incr",
      "pExpire",
      "pTTL",
    ]
  ) {
    let owner: object | null = value;
    const visited = new Set<object>();
    let found = false;
    while (owner) {
      if (visited.has(owner)) {
        throw new TypeError("Redis client factory result has a cyclic prototype chain");
      }
      visited.add(owner);
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(owner, method);
      } catch (cause) {
        throw new TypeError(`Redis client factory result ${method} could not be inspected`, {
          cause,
        });
      }
      if (descriptor) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") {
          throw new TypeError(`Redis client factory result ${method} must be a data method`);
        }
        found = true;
        break;
      }
      try {
        owner = Object.getPrototypeOf(owner);
      } catch (cause) {
        throw new TypeError(
          `Redis client factory result ${method} prototype could not be inspected`,
          { cause },
        );
      }
    }
    if (!found) {
      throw new TypeError(`Redis client factory result must expose ${method}`);
    }
  }
}

/** Open one independently owned Redis connection. */
export async function openRedisClient(
  options: RedisClientOptions = {},
  dependencies: RedisClientManagerDependencies = {},
  lifecycle: RedisClientOpenLifecycle = {},
): Promise<RedisClient> {
  const capturedOptions = captureClientOptions(options);
  const resolved = resolveClientOptions(capturedOptions, dependencies.getEnv ?? getEnv);
  const factory = await raceWithAbort(
    (dependencies.loadFactory ?? loadDefaultFactory)(),
    lifecycle.signal,
  );
  const client = factory(resolved.factoryOptions);
  assertRedisClient(client);
  let cleanup = () => client.disconnect();
  let cleanupTail = Promise.resolve();
  const enqueueCleanup = (): Promise<void> => {
    const attempt = cleanupTail.catch(() => undefined).then(() => cleanup());
    cleanupTail = attempt;
    return attempt;
  };

  try {
    if (lifecycle.onClientCreated) {
      const observedCleanup = lifecycle.onClientCreated(client);
      if (observedCleanup) cleanup = observedCleanup;
    }
    const connectAttempt = Promise.resolve().then(() => client.connect());
    let connectSettled = false;
    void connectAttempt.then(
      () => {
        connectSettled = true;
      },
      () => {
        connectSettled = true;
      },
    );
    try {
      await raceWithAbort(connectAttempt, lifecycle.signal);
    } catch (error) {
      if (!connectSettled) {
        void connectAttempt.then(
          () => enqueueCleanup(),
          () => enqueueCleanup(),
        ).catch((lateCleanupError) => {
          logCleanupFailure("Redis client late-connect cleanup failed", lateCleanupError);
        });
      }
      throw error;
    }
    return client;
  } catch (error) {
    try {
      await enqueueCleanup();
    } catch (closeError) {
      if (lifecycle.onClientCreated) {
        throw new AggregateError(
          [error, closeError],
          "Redis client setup and observed cleanup failed",
        );
      }
      throw new RedisClientSetupCleanupError(error, closeError, client);
    }
    throw error;
  }
}

async function disconnectClient(client: RedisClient): Promise<void> {
  if (client.isOpen === false) return;
  await client.disconnect();
}

/** Create an isolated, concurrency-safe Redis client manager. */
export function createRedisClientManager(
  dependencies: RedisClientManagerDependencies = {},
): RedisClientManager {
  const readEnv = dependencies.getEnv ?? getEnv;
  const loadFactory = dependencies.loadFactory ?? loadDefaultFactory;
  const now = dependencies.now ?? Date.now;
  const states = new Map<string, ConnectionState>();
  const orphanedClients = new Set<RedisClient>();
  const clientDisconnections = new WeakMap<RedisClient, Promise<void>>();
  let disconnectVersion = 0;
  let disconnecting: Promise<void> | null = null;

  function disconnectTrackedClient(client: RedisClient): Promise<void> {
    const existing = clientDisconnections.get(client);
    if (existing) return existing;
    const pending = disconnectClient(client).then(
      () => {
        orphanedClients.delete(client);
      },
      (error) => {
        orphanedClients.add(client);
        throw error;
      },
    );
    const tracked = pending.finally(() => {
      if (clientDisconnections.get(client) === tracked) clientDisconnections.delete(client);
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
    let capturedOptions: Readonly<RedisClientOptions>;
    try {
      capturedOptions = captureClientOptions(options);
    } catch (error) {
      return Promise.reject(error);
    }
    if (disconnecting) {
      return disconnecting.then(() => getClient(capturedOptions));
    }
    if (orphanedClients.size > 0) {
      return disconnect().then(() => getClient(capturedOptions));
    }

    let resolved: ResolvedRedisClientOptions;
    try {
      resolved = resolveClientOptions(capturedOptions, readEnv);
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
          ) logger.info("Reconnecting...");
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

      const connectAttempt = Promise.resolve().then(() => client.connect());
      let connectSettled = false;
      void connectAttempt.then(
        () => {
          connectSettled = true;
        },
        () => {
          connectSettled = true;
        },
      );
      try {
        await Promise.race([connectAttempt, cancellation]);
      } catch (error) {
        const immediateCleanup = disconnectTrackedClient(client);
        if (!connectSettled) {
          void connectAttempt.then(
            async () => {
              await immediateCleanup.catch(() => undefined);
              await disconnectTrackedClient(client);
            },
            async () => {
              await immediateCleanup.catch(() => undefined);
              await disconnectTrackedClient(client);
            },
          ).catch((lateCleanupError) => {
            logCleanupFailure("Redis manager late-connect cleanup failed", lateCleanupError);
          });
        }
        try {
          await immediateCleanup;
        } catch (closeError) {
          throw new AggregateError(
            [error, closeError],
            "Redis client connection and cleanup failed",
          );
        }
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
        try {
          await disconnectTrackedClient(client);
        } catch (closeError) {
          throw new AggregateError(
            [connectionCancelledError(), closeError],
            "Redis client cancellation cleanup failed",
          );
        }
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
    for (const client of orphanedClients) clients.add(client);
    for (const state of states.values()) {
      state.generation++;
      state.cancelConnecting?.();
      if (state.client) clients.add(state.client);
      if (state.provisionalClient) clients.add(state.provisionalClient);
      state.client = undefined;
      state.provisionalClient = undefined;
    }
    states.clear();

    const pending = Promise.allSettled([...clients].map(disconnectTrackedClient)).then(
      (results) => {
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason);
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, "Redis client manager disconnect failed");
        }
      },
    );
    const tracked = pending.finally(() => {
      if (disconnecting === tracked) disconnecting = null;
    });
    disconnecting = tracked;
    return tracked;
  }

  function isConfigured(options: RedisClientOptions = {}): boolean {
    const capturedOptions = captureClientOptions(options);
    const configured = capturedOptions.url ?? readEnv("REDIS_URL");
    if (configured === undefined || configured.length === 0) return false;
    requireRedisUrl(configured);
    return true;
  }

  return { getClient, disconnect, isConfigured };
}

const defaultManager = createRedisClientManager();

/** Acquire a connection from the extension-owned shared manager. */
export function getRedisClient(options: RedisClientOptions = {}): Promise<RedisClient> {
  return defaultManager.getClient(options);
}

/** Disconnect the shared manager so the next call reconnects from a clean state. */
export function disconnectRedisClient(): Promise<void> {
  return defaultManager.disconnect();
}

/** Report whether the shared manager has an explicit Redis endpoint. */
export function isRedisConfigured(options: RedisClientOptions = {}): boolean {
  return defaultManager.isConfigured(options);
}
