/**
 * Redis Token Cache
 *
 * Distributed cache using Redis for multi-instance deployments.
 * Uses native Deno TCP for Redis protocol (no external dependencies).
 */

import type { CacheStats, RedisCacheOptions, TokenCache, TokenCacheEntry } from "./types.ts";

const DEFAULT_PREFIX = "vf:token:";
const DEFAULT_CONNECT_TIMEOUT = 5000;
const DEFAULT_COMMAND_TIMEOUT = 3000;

/**
 * Lightweight Redis client using Deno TCP.
 * Implements only the commands needed for token caching.
 */
class RedisClient {
  private conn: Deno.TcpConn | null = null;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private host: string;
  private port: number;
  private password?: string;
  private connectTimeout: number;
  private commandTimeout: number;

  constructor(url: string, options: { connectTimeout?: number; commandTimeout?: number } = {}) {
    const parsed = new URL(url);
    this.host = parsed.hostname;
    this.port = parseInt(parsed.port) || 6379;
    this.password = parsed.password || undefined;
    this.connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
    this.commandTimeout = options.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT;
  }

  async connect(): Promise<void> {
    if (this.conn) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.connectTimeout);

    try {
      this.conn = await Deno.connect({
        hostname: this.host,
        port: this.port,
      });

      // Authenticate if password is provided
      if (this.password) {
        await this.sendCommand("AUTH", this.password);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async close(): Promise<void> {
    if (this.conn) {
      try {
        this.conn.close();
      } catch {
        // Ignore close errors
      }
      this.conn = null;
    }
  }

  async get(key: string): Promise<string | null> {
    return await this.sendCommand("GET", key) as string | null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.sendCommand("SETEX", key, String(Math.ceil(ttlSeconds)), value);
    } else {
      await this.sendCommand("SET", key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.sendCommand("DEL", key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.sendCommand("EXISTS", key);
    return result === 1;
  }

  async flushdb(): Promise<void> {
    await this.sendCommand("FLUSHDB");
  }

  async dbsize(): Promise<number> {
    return await this.sendCommand("DBSIZE") as number;
  }

  private async sendCommand(...args: string[]): Promise<unknown> {
    if (!this.conn) {
      await this.connect();
    }

    const command = this.encodeCommand(args);
    await this.conn!.write(this.encoder.encode(command));

    const response = await this.readResponse();
    return response;
  }

  private encodeCommand(args: string[]): string {
    let cmd = `*${args.length}\r\n`;
    for (const arg of args) {
      cmd += `$${this.encoder.encode(arg).length}\r\n${arg}\r\n`;
    }
    return cmd;
  }

  private async readResponse(): Promise<unknown> {
    const buffer = new Uint8Array(4096);
    const n = await this.conn!.read(buffer);
    if (n === null) {
      throw new Error("Connection closed");
    }

    const response = this.decoder.decode(buffer.subarray(0, n));
    return this.parseResponse(response);
  }

  private parseResponse(response: string): unknown {
    const type = response[0];
    const data = response.slice(1);
    const lines = data.split("\r\n");
    const firstLine = lines[0] ?? "";

    switch (type) {
      case "+": // Simple string
        return firstLine;
      case "-": // Error
        throw new Error(firstLine);
      case ":": // Integer
        return parseInt(firstLine, 10);
      case "$": { // Bulk string
        const len = parseInt(firstLine, 10);
        if (len === -1) return null;
        return lines[1];
      }
      case "*": { // Array
        // Not implemented for our use case
        return null;
      }
      default:
        return null;
    }
  }
}

export class RedisCache implements TokenCache {
  private client: RedisClient;
  private prefix: string;
  private hits = 0;
  private misses = 0;
  private connected = false;

  constructor(options: RedisCacheOptions) {
    this.client = new RedisClient(options.url, {
      connectTimeout: options.connectTimeout,
      commandTimeout: options.commandTimeout,
    });
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get(key: string): Promise<TokenCacheEntry | null> {
    try {
      await this.ensureConnected();
      const data = await this.client.get(this.key(key));

      if (!data) {
        this.misses++;
        return null;
      }

      const entry = JSON.parse(data) as TokenCacheEntry;

      // Check if expired (Redis TTL should handle this, but double-check)
      if (Date.now() >= entry.expiresAt) {
        await this.client.del(this.key(key));
        this.misses++;
        return null;
      }

      this.hits++;
      return entry;
    } catch (error) {
      console.error("[RedisCache] Get error:", error);
      this.misses++;
      return null;
    }
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    try {
      await this.ensureConnected();

      // Calculate TTL in seconds
      const ttlMs = entry.expiresAt - Date.now();
      const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));

      await this.client.set(
        this.key(key),
        JSON.stringify(entry),
        ttlSeconds,
      );
    } catch (error) {
      console.error("[RedisCache] Set error:", error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client.del(this.key(key));
    } catch (error) {
      console.error("[RedisCache] Delete error:", error);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.ensureConnected();
      // Note: This clears the entire DB, not just our prefix
      // For production, use SCAN with prefix pattern instead
      await this.client.flushdb();
      this.hits = 0;
      this.misses = 0;
    } catch (error) {
      console.error("[RedisCache] Clear error:", error);
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      await this.ensureConnected();
      return await this.client.exists(this.key(key));
    } catch (error) {
      console.error("[RedisCache] Has error:", error);
      return false;
    }
  }

  async stats(): Promise<CacheStats> {
    let size = 0;
    try {
      await this.ensureConnected();
      size = await this.client.dbsize();
    } catch {
      // Ignore stats errors
    }

    return {
      hits: this.hits,
      misses: this.misses,
      size,
      type: "redis",
    };
  }

  async close(): Promise<void> {
    await this.client.close();
    this.connected = false;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
      console.log("[RedisCache] Connected to Redis");
    }
  }
}
