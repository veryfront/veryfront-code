/**
 * Shared Redis Client Utility
 *
 * Provides a singleton Redis client with connection pooling,
 * automatic reconnection, and graceful fallback handling.
 */

import { getRedisUrlEnv } from "#veryfront/config/env.ts";
import { logger } from "./logger/logger.ts";

export interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  get(key: string): Promise<string | null>;
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
  /** Connection timeout in milliseconds */
  connectTimeout?: number;
  /** Enable auto-reconnect on disconnect */
  autoReconnect?: boolean;
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
    throw new Error("[Redis] Connection recently failed, waiting before retry");
  }

  if (isConnecting && connectionPromise) return connectionPromise;

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

async function createClient(options: RedisClientOptions): Promise<RedisClient> {
  let createClientFn: ((opts: { url?: string }) => RedisClient) | undefined;

  try {
    const redisClientModule = ["npm:@redis/client", "@1.5.8"].join("");
    const mod = await import(redisClientModule);
    createClientFn = mod.createClient as (opts: { url?: string }) => RedisClient;
  } catch {
    throw new Error(
      "[Redis] Failed to load @redis/client. Install with: deno add npm:@redis/client@1.5.8",
    );
  }

  const client = createClientFn({ url: options.url ?? getRedisUrlEnv() });

  if (typeof client.on === "function") {
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

export function isRedisAvailable(): boolean {
  return sharedClient !== null && sharedClient.isOpen !== false && !connectionFailed;
}

export function isRedisConfigured(): boolean {
  return !!getRedisUrlEnv();
}

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

export function resetRedisState(): void {
  sharedClient = null;
  connectionFailed = false;
  isConnecting = false;
  connectionPromise = null;
  lastConnectionAttempt = 0;
}
