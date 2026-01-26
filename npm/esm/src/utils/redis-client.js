/**
 * Shared Redis Client Utility
 *
 * Provides a singleton Redis client with connection pooling,
 * automatic reconnection, and graceful fallback handling.
 */
import { getRedisUrlEnv } from "../config/env.js";
import { logger } from "./logger/logger.js";
let sharedClient = null;
let connectionPromise = null;
let isConnecting = false;
let connectionFailed = false;
let lastConnectionAttempt = 0;
const RECONNECT_DELAY_MS = 5000;
export async function getRedisClient(options = {}) {
    if (sharedClient && sharedClient.isOpen !== false)
        return sharedClient;
    if (connectionFailed && Date.now() - lastConnectionAttempt < RECONNECT_DELAY_MS) {
        throw new Error("[Redis] Connection recently failed, waiting before retry");
    }
    if (isConnecting && connectionPromise)
        return connectionPromise;
    isConnecting = true;
    lastConnectionAttempt = Date.now();
    connectionPromise = createClient(options);
    try {
        sharedClient = await connectionPromise;
        connectionFailed = false;
        logger.info("[Redis] Connected successfully");
        return sharedClient;
    }
    catch (error) {
        connectionFailed = true;
        sharedClient = null;
        throw error;
    }
    finally {
        isConnecting = false;
        connectionPromise = null;
    }
}
async function createClient(options) {
    let createClientFn;
    try {
        const redisClientModule = ["npm:@redis/client", "@1.5.8"].join("");
        const mod = await import(redisClientModule);
        createClientFn = mod.createClient;
    }
    catch {
        throw new Error("[Redis] Failed to load @redis/client. Install with: deno add npm:@redis/client@1.5.8");
    }
    const client = createClientFn({ url: options.url ?? getRedisUrlEnv() });
    if (typeof client.on === "function") {
        client.on("error", (err) => {
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
export function isRedisAvailable() {
    return sharedClient !== null && sharedClient.isOpen !== false && !connectionFailed;
}
export function isRedisConfigured() {
    return !!getRedisUrlEnv();
}
export async function disconnectRedis() {
    if (sharedClient) {
        try {
            await sharedClient.disconnect();
        }
        catch {
            // Ignore disconnect errors
        }
        sharedClient = null;
    }
    connectionFailed = false;
    isConnecting = false;
    connectionPromise = null;
}
export function resetRedisState() {
    sharedClient = null;
    connectionFailed = false;
    isConnecting = false;
    connectionPromise = null;
    lastConnectionAttempt = 0;
}
