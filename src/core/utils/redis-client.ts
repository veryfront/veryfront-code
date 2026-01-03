/**
 * Shared Redis Client Utility
 *
 * Provides a singleton Redis client with connection pooling,
 * automatic reconnection, and graceful fallback handling.
 */

import { logger } from "./logger/logger.ts";

export interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<string | null>;
  del(key: string | string[]): Promise<number>;
  scan(cursor: number, options?: { MATCH?: string; COUNT?: number }): Promise<{ cursor: number; keys: string[] }>;
  expire(key: string, seconds: number): Promise<number>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  isOpen?: boolean;
}

export interface RedisClientOptions {
  url?: string;
  /** Connection timeout in milliseconds */
  connectTimeout?: number;
  /** Enable auto-reconnect on disconnect */
  autoReconnect?: boolean;
}

// Singleton client instance
let sharedClient: RedisClient | null = null;
let connectionPromise: Promise<RedisClient> | null = null;
let isConnecting = false;
let connectionFailed = false;
let lastConnectionAttempt = 0;

const RECONNECT_DELAY_MS = 5000; // Wait 5 seconds before retrying failed connection

/**
 * Get or create the shared Redis client.
 * Uses a singleton pattern to avoid multiple connections.
 */
export async function getRedisClient(options: RedisClientOptions = {}): Promise<RedisClient> {
  // If we have a connected client, return it
  if (sharedClient && sharedClient.isOpen !== false) {
    return sharedClient;
  }

  // If connection recently failed, don't retry immediately
  if (connectionFailed && Date.now() - lastConnectionAttempt < RECONNECT_DELAY_MS) {
    throw new Error("[Redis] Connection recently failed, waiting before retry");
  }

  // If already connecting, wait for that promise
  if (isConnecting && connectionPromise) {
    return connectionPromise;
  }

  // Start new connection
  isConnecting = true;
  lastConnectionAttempt = Date.now();

  connectionPromise = createClient(options);

  try {
    sharedClient = await connectionPromise;
    connectionFailed = false;
    logger.info("[Redis] Connected successfully");
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

/**
 * Create a new Redis client instance.
 */
async function createClient(options: RedisClientOptions): Promise<RedisClient> {
  let createClientFn: ((opts: { url?: string }) => RedisClient) | undefined;

  try {
    // Dynamic import to avoid static analysis issues with Deno
    const redisClientModule = ["npm:@redis/client", "@1.5.8"].join("");
    const mod = await import(redisClientModule);
    createClientFn = mod.createClient as unknown as (opts: { url?: string }) => RedisClient;
  } catch {
    throw new Error(
      "[Redis] Failed to load @redis/client. Install with: deno add npm:@redis/client@1.5.8"
    );
  }

  const url = options.url || getEnvRedisUrl();
  const client = createClientFn({ url });

  // Set up error handler
  if (typeof client?.on === "function") {
    client.on("error", (err: unknown) => {
      logger.error("[Redis] Client error", err);
      connectionFailed = true;
    });

    client.on("reconnecting", () => {
      logger.info("[Redis] Reconnecting...");
    });

    client.on("ready", () => {
      logger.info("[Redis] Ready");
      connectionFailed = false;
    });
  }

  await client.connect();
  return client;
}

/**
 * Get Redis URL from environment.
 */
function getEnvRedisUrl(): string | undefined {
  try {
    if (typeof Deno !== "undefined" && Deno.env) {
      return Deno.env.get("REDIS_URL");
    }
  } catch {
    // Ignore env access errors
  }
  return undefined;
}

/**
 * Check if Redis is available (has a connected client).
 */
export function isRedisAvailable(): boolean {
  return sharedClient !== null && sharedClient.isOpen !== false && !connectionFailed;
}

/**
 * Check if Redis is configured (URL is set).
 */
export function isRedisConfigured(): boolean {
  return !!getEnvRedisUrl();
}

/**
 * Disconnect and cleanup the shared client.
 */
export async function disconnectRedis(): Promise<void> {
  if (sharedClient) {
    try {
      await sharedClient.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    sharedClient = null;
  }
  connectionFailed = false;
  isConnecting = false;
  connectionPromise = null;
}

/**
 * Reset connection state (for testing).
 */
export function resetRedisState(): void {
  sharedClient = null;
  connectionFailed = false;
  isConnecting = false;
  connectionPromise = null;
  lastConnectionAttempt = 0;
}
