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
  socket?: { tls?: boolean };
  password?: string;
  username?: string;
}

let sharedClient: RedisClient | null = null;
let connectionPromise: Promise<RedisClient> | null = null;
let isConnecting = false;
let connectionFailed = false;
let lastConnectionAttempt = 0;

const RECONNECT_DELAY_MS = 5000;

export async function getRedisClient(options: RedisClientOptions = {}): Promise<RedisClient> {
  if (sharedClient && sharedClient.isOpen !== false) return sharedClient;

  if (connectionFailed && Date.now() - lastConnectionAttempt < RECONNECT_DELAY_MS) {
    throw INITIALIZATION_ERROR.create({
      detail: "[Redis] Connection recently failed, waiting before retry",
    });
  }

  if (isConnecting && connectionPromise) return connectionPromise;

  isConnecting = true;
  lastConnectionAttempt = Date.now();
  connectionPromise = createClient(options);

  try {
    sharedClient = await connectionPromise;
    connectionFailed = false;
    logger.info("Connected successfully");
    return sharedClient;
  } catch (error) {
    connectionFailed = true;
    sharedClient = null;
    throw error;
  } finally {
    isConnecting = false;
    connectionPromise = null;
  }
}

async function createClient(options: RedisClientOptions): Promise<RedisClient> {
  let createClientFn: ((opts: RedisClientFactoryOptions) => RedisClient) | undefined;

  try {
    const redisClientModule = "npm:@redis/client@1.5.8";
    const mod = await import(redisClientModule);
    createClientFn = mod.createClient as (opts: RedisClientFactoryOptions) => RedisClient;
  } catch (error) {
    logger.debug("Failed to load @redis/client module", { error });
    throw DEPENDENCY_MISSING.create({
      detail:
        "[Redis] Failed to load @redis/client. Install with: deno add npm:@redis/client@1.5.8",
    });
  }

  const url = options.url ?? getEnv("REDIS_URL");
  const useTls = options.tls ?? url?.startsWith("rediss://") ?? false;

  if (!useTls && getEnv("NODE_ENV") === "production") {
    logger.warn(
      "Redis connection without TLS in production. Set REDIS_URL to rediss:// or pass tls: true.",
    );
  }

  const clientOpts: RedisClientFactoryOptions = { url };
  if (useTls) {
    clientOpts.socket = { tls: true };
  }
  const password = options.password ?? getEnv("REDIS_PASSWORD");
  if (password) {
    clientOpts.password = password;
  }
  const username = options.username ?? getEnv("REDIS_USERNAME");
  if (username) {
    clientOpts.username = username;
  }

  const client = createClientFn(clientOpts);

  if (typeof client.on === "function") {
    client.on("error", (err: unknown) => {
      logger.error("Client error", err);
      connectionFailed = true;
    });

    client.on("reconnecting", () => {
      logger.info("Reconnecting...");
    });

    client.on("ready", () => {
      logger.info("Ready");
      connectionFailed = false;
    });
  }

  await client.connect();
  return client;
}

export function isRedisConfigured(): boolean {
  return Boolean(getEnv("REDIS_URL"));
}
