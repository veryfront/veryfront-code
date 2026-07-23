import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { logger as baseLogger } from "./logger/logger.ts";
import { DEPENDENCY_MISSING } from "#veryfront/errors/error-registry/module.ts";
import {
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
} from "#veryfront/errors/error-registry/general.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

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

/**
 * Minimal subset of `@redis/client`'s `createClient` options that we actually
 * pass. Declared locally so we don't depend on the untyped npm surface (the
 * module is loaded via a dynamic `import()` and is otherwise `any`).
 */
interface RedisClientFactoryOptions {
  url?: string;
  socket?: {
    connectTimeout?: number;
    reconnectStrategy?: false;
    tls?: boolean;
  };
  password?: string;
  username?: string;
}

type RedisClientFactory = (options: RedisClientFactoryOptions) => RedisClient;

interface ResolvedRedisClientOptions {
  autoReconnect: boolean | undefined;
  connectTimeout: number | undefined;
  password: string | undefined;
  tls: boolean;
  url: string | undefined;
  username: string | undefined;
}

let sharedClient: RedisClient | null = null;
let sharedOptions: ResolvedRedisClientOptions | null = null;
let connectionPromise: Promise<RedisClient> | null = null;
let pendingOptions: ResolvedRedisClientOptions | null = null;
let connectionFailed = false;
let lastConnectionAttempt = 0;
let failedOptions: ResolvedRedisClientOptions | null = null;
let connectionGeneration = 0;
const pendingClients = new Set<RedisClient>();
let injectedClientFactory: RedisClientFactory | null = null;

const RECONNECT_DELAY_MS = 5000;
const MAX_CONNECT_TIMEOUT_MS = 120_000;
const MAX_REDIS_URL_LENGTH = 4_096;
const MAX_REDIS_USERNAME_LENGTH = 1_024;
const MAX_REDIS_PASSWORD_LENGTH = 16_384;
const REDIS_CLIENT_SPECIFIER = "npm:@redis/client@1.5.8";
// deno-lint-ignore no-control-regex -- rejects terminal and protocol control bytes
const ASCII_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function optionsEqual(
  left: ResolvedRedisClientOptions | null,
  right: ResolvedRedisClientOptions,
): boolean {
  return left !== null &&
    left.autoReconnect === right.autoReconnect &&
    left.connectTimeout === right.connectTimeout &&
    left.password === right.password &&
    left.tls === right.tls &&
    left.url === right.url &&
    left.username === right.username;
}

function invalidOption(detail: string): VeryfrontError {
  return INVALID_ARGUMENT.create({ detail });
}

function resolveCredential(
  optionValue: unknown,
  envName: "REDIS_PASSWORD" | "REDIS_USERNAME",
  label: string,
  maxLength: number,
): string | undefined {
  if (optionValue !== undefined && typeof optionValue !== "string") {
    throw invalidOption(`Redis ${label} must be a string.`);
  }
  const value = optionValue as string | undefined ?? getHostEnv(envName);
  if (value === undefined || value.length === 0) return undefined;
  if (value.length > maxLength) {
    throw invalidOption(`Redis ${label} must be at most ${maxLength} characters.`);
  }
  return value;
}

function resolveOptions(options: RedisClientOptions): ResolvedRedisClientOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw invalidOption("Redis options must be an object.");
  }

  let autoReconnect: unknown;
  let connectTimeout: unknown;
  let password: unknown;
  let tls: unknown;
  let urlOption: unknown;
  let username: unknown;
  try {
    autoReconnect = options.autoReconnect;
    connectTimeout = options.connectTimeout;
    password = options.password;
    tls = options.tls;
    urlOption = options.url;
    username = options.username;
  } catch {
    throw invalidOption("Redis options could not be read safely.");
  }

  if (urlOption !== undefined && typeof urlOption !== "string") {
    throw invalidOption("Redis URL must be a string.");
  }
  if (tls !== undefined && typeof tls !== "boolean") {
    throw invalidOption("Redis tls must be a boolean.");
  }
  if (autoReconnect !== undefined && typeof autoReconnect !== "boolean") {
    throw invalidOption("Redis autoReconnect must be a boolean.");
  }

  const url = urlOption as string | undefined ?? getHostEnv("REDIS_URL");
  if (url !== undefined) {
    if (
      url.length === 0 || url.length > MAX_REDIS_URL_LENGTH || ASCII_CONTROL_CHARACTER.test(url)
    ) {
      throw invalidOption(
        `Redis URL must be a non-empty value of at most ${MAX_REDIS_URL_LENGTH} characters.`,
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw invalidOption("Redis URL must be a valid redis:// or rediss:// URL.");
    }
    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
      throw invalidOption("Redis URL must use the redis:// or rediss:// scheme.");
    }
  }

  if (
    connectTimeout !== undefined &&
    (!Number.isSafeInteger(connectTimeout) ||
      (connectTimeout as number) < 1 ||
      (connectTimeout as number) > MAX_CONNECT_TIMEOUT_MS)
  ) {
    throw invalidOption(
      `Redis connectTimeout must be an integer between 1 and ${MAX_CONNECT_TIMEOUT_MS} ms.`,
    );
  }

  const resolvedPassword = resolveCredential(
    password,
    "REDIS_PASSWORD",
    "password",
    MAX_REDIS_PASSWORD_LENGTH,
  );
  const resolvedUsername = resolveCredential(
    username,
    "REDIS_USERNAME",
    "username",
    MAX_REDIS_USERNAME_LENGTH,
  );

  return {
    autoReconnect: autoReconnect as boolean | undefined,
    connectTimeout: connectTimeout as number | undefined,
    password: resolvedPassword,
    tls: tls === true || url?.startsWith("rediss://") === true,
    url,
    username: resolvedUsername,
  };
}

function sanitizedCause(error: unknown): { name: string } {
  return { name: error instanceof Error ? error.name : typeof error };
}

function cancelledConnectionError(): VeryfrontError {
  return INITIALIZATION_ERROR.create({ detail: "Redis connection was cancelled." });
}

async function disconnectClient(client: RedisClient, message: string): Promise<void> {
  try {
    await client.disconnect();
  } catch (error) {
    logger.debug(message, error);
  }
}

export function getRedisClient(options: RedisClientOptions = {}): Promise<RedisClient> {
  let resolvedOptions: ResolvedRedisClientOptions;
  try {
    resolvedOptions = resolveOptions(options);
  } catch (error) {
    return Promise.reject(
      error instanceof VeryfrontError
        ? error
        : invalidOption("Redis options could not be read safely."),
    );
  }

  // Reuse a healthy, connected client. A client whose `error` event fired sets
  // connectionFailed=true even while `isOpen` may still report true, so we must
  // not hand back a client in that state (a stale, broken client would make all
  // cache ops silently return null).
  if (
    sharedClient && sharedClient.isOpen !== false && !connectionFailed &&
    optionsEqual(sharedOptions, resolvedOptions)
  ) {
    return Promise.resolve(sharedClient);
  }

  // A connect is already in flight: share the single promise. This is checked
  // and the new promise assigned synchronously below with no `await` in between,
  // so concurrent callers cannot each start their own connection (the previous
  // isConnecting/connectionPromise split had a TOCTOU race that leaked
  // connections and could exhaust Redis connection limits).
  if (connectionPromise && optionsEqual(pendingOptions, resolvedOptions)) return connectionPromise;

  if (
    connectionFailed && optionsEqual(failedOptions, resolvedOptions) &&
    Date.now() - lastConnectionAttempt < RECONNECT_DELAY_MS
  ) {
    return Promise.reject(
      INITIALIZATION_ERROR.create({
        detail: "[Redis] Connection recently failed, waiting before retry",
      }),
    );
  }

  // Tear down any stale client before reconnecting so we don't leak the old one.
  if (sharedClient) {
    const stale = sharedClient;
    sharedClient = null;
    sharedOptions = null;
    void disconnectClient(stale, "Error disconnecting stale client");
  }

  const generation = ++connectionGeneration;
  for (const pendingClient of pendingClients) {
    void disconnectClient(pendingClient, "Error disconnecting superseded client");
  }
  lastConnectionAttempt = Date.now();
  const promise = createClient(resolvedOptions, generation)
    .then((client) => {
      if (generation !== connectionGeneration) {
        void disconnectClient(client, "Error disconnecting cancelled client");
        throw cancelledConnectionError();
      }
      sharedClient = client;
      sharedOptions = resolvedOptions;
      connectionFailed = false;
      failedOptions = null;
      logger.info("Connected successfully");
      return client;
    })
    .catch((error) => {
      if (generation !== connectionGeneration) throw cancelledConnectionError();

      connectionFailed = true;
      failedOptions = resolvedOptions;
      if (sharedClient?.isOpen === false) {
        sharedClient = null;
        sharedOptions = null;
      }
      if (error instanceof VeryfrontError) throw error;

      logger.error("Connection failed", error);
      throw INITIALIZATION_ERROR.create({
        cause: sanitizedCause(error),
        detail: "Redis connection failed.",
      });
    })
    .finally(() => {
      if (connectionPromise === promise) {
        connectionPromise = null;
        pendingOptions = null;
      }
    });

  connectionPromise = promise;
  pendingOptions = resolvedOptions;
  return promise;
}

/** Disconnect and clear the shared client so the next call reconnects fresh. */
export async function disconnectRedisClient(): Promise<void> {
  connectionGeneration++;
  const client = sharedClient;
  sharedClient = null;
  sharedOptions = null;
  connectionPromise = null;
  pendingOptions = null;
  connectionFailed = false;
  failedOptions = null;
  lastConnectionAttempt = 0;

  const pending = [...pendingClients];
  for (const pendingClient of pending) {
    void disconnectClient(pendingClient, "Error disconnecting pending client");
  }
  if (client) await disconnectClient(client, "Error during disconnect");
}

async function loadClientFactory(): Promise<RedisClientFactory> {
  if (injectedClientFactory) return injectedClientFactory;

  try {
    const mod = await import(REDIS_CLIENT_SPECIFIER);
    if (typeof mod.createClient !== "function") throw new TypeError("createClient export missing");
    return mod.createClient as RedisClientFactory;
  } catch (error) {
    logger.debug("Failed to load @redis/client module", error);
    throw DEPENDENCY_MISSING.create({
      cause: sanitizedCause(error),
      detail:
        `[Redis] Failed to load @redis/client. Install with: deno add ${REDIS_CLIENT_SPECIFIER}`,
    });
  }
}

async function createClient(
  options: ResolvedRedisClientOptions,
  generation: number,
): Promise<RedisClient> {
  const createClientFn = await loadClientFactory();
  if (generation !== connectionGeneration) throw cancelledConnectionError();

  if (!options.tls && getHostEnv("NODE_ENV") === "production") {
    logger.warn(
      "Redis connection without TLS in production. Set REDIS_URL to rediss:// or pass tls: true.",
    );
  }

  const clientOpts: RedisClientFactoryOptions = {};
  if (options.url !== undefined) clientOpts.url = options.url;
  const socket: NonNullable<RedisClientFactoryOptions["socket"]> = {};
  if (options.tls) socket.tls = true;
  if (options.connectTimeout !== undefined) socket.connectTimeout = options.connectTimeout;
  if (options.autoReconnect === false) socket.reconnectStrategy = false;
  if (Object.keys(socket).length > 0) clientOpts.socket = socket;
  if (options.password) clientOpts.password = options.password;
  if (options.username) clientOpts.username = options.username;

  const client = createClientFn(clientOpts);
  pendingClients.add(client);

  if (typeof client.on === "function") {
    client.on("error", (err: unknown) => {
      if (generation !== connectionGeneration) return;
      logger.error("Client error", err);
      connectionFailed = true;
    });

    client.on("reconnecting", () => {
      if (generation !== connectionGeneration) return;
      logger.info("Reconnecting...");
    });

    client.on("ready", () => {
      if (generation !== connectionGeneration) return;
      logger.info("Ready");
      connectionFailed = false;
    });
  }

  try {
    await client.connect();
    return client;
  } finally {
    pendingClients.delete(client);
  }
}

export function isRedisConfigured(): boolean {
  return Boolean(getHostEnv("REDIS_URL"));
}

/** @internal Inject a deterministic client factory for unit tests. */
export function __setRedisClientFactoryForTests(factory: RedisClientFactory | null): void {
  injectedClientFactory = factory;
}
