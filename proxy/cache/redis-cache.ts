/**
 * Redis Token Cache - zero external dependencies.
 * Uses native Deno TCP for RESP protocol.
 */

import type { CacheStats, RedisCacheOptions, TokenCache, TokenCacheEntry } from "./types.ts";

const DEFAULT_PREFIX = "vf:token:";
const DEFAULT_CONNECT_TIMEOUT = 5000;
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_SCAN_COUNT = 100;
const MAX_RECONNECT_ATTEMPTS = 3;
const CRLF_LENGTH = 2;

// RESP protocol bytes
const CR = 0x0d; // \r
const RESP_SIMPLE_STRING = "+";
const RESP_ERROR = "-";
const RESP_INTEGER = ":";
const RESP_BULK_STRING = "$";
const RESP_ARRAY = "*";
const RESP_NULL_LENGTH = -1;

class RedisClient {
  private conn: Deno.TcpConn | null = null;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private host: string;
  private port: number;
  private password?: string;
  private connectTimeout: number;

  constructor(url: string, options: { connectTimeout?: number } = {}) {
    const parsed = new URL(url);
    this.host = parsed.hostname;
    this.port = parseInt(parsed.port) || DEFAULT_REDIS_PORT;
    this.password = parsed.password || undefined;
    this.connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
  }

  async connect(): Promise<void> {
    if (this.conn) return;

    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const connectPromise = Deno.connect({ hostname: this.host, port: this.port });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error("Connection timeout"));
      }, this.connectTimeout);
    });

    try {
      this.conn = await Promise.race([connectPromise, timeoutPromise]);
      clearTimeout(timeoutId!);
      if (this.password) {
        await this.sendCommand("AUTH", this.password);
      }
    } catch (error) {
      clearTimeout(timeoutId!);
      // If timed out, clean up late connection when it resolves
      if (timedOut) {
        connectPromise.then((conn) => conn.close()).catch(() => {});
      }
      this.conn = null;
      throw error;
    }
  }

  close(): void {
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

  async del(...keys: string[]): Promise<number> {
    return await this.sendCommand("DEL", ...keys) as number;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.sendCommand("EXISTS", key)) === 1;
  }

  async scan(cursor: string, pattern: string, count = DEFAULT_SCAN_COUNT): Promise<[string, string[]]> {
    return await this.sendCommand("SCAN", cursor, "MATCH", pattern, "COUNT", String(count)) as [string, string[]];
  }

  async dbsize(): Promise<number> {
    return await this.sendCommand("DBSIZE") as number;
  }

  private sendCommand(...args: string[]): Promise<unknown> {
    return this.sendCommandWithRetry(args, 0);
  }

  private async sendCommandWithRetry(args: string[], attempt: number): Promise<unknown> {
    if (!this.conn) {
      await this.connect();
    }

    try {
      const command = this.encodeCommand(args);
      await this.conn!.write(this.encoder.encode(command));
      return await this.readResponse();
    } catch (error) {
      if (attempt < MAX_RECONNECT_ATTEMPTS && this.isConnectionError(error)) {
        console.warn(`[RedisClient] Connection error, reconnecting (attempt ${attempt + 1})`);
        this.close();
        return this.sendCommandWithRetry(args, attempt + 1);
      }
      throw error;
    }
  }

  private isConnectionError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return msg.includes("connection") || msg.includes("broken pipe") || msg.includes("reset");
  }

  private encodeCommand(args: string[]): string {
    let cmd = `*${args.length}\r\n`;
    for (const arg of args) {
      cmd += `$${this.encoder.encode(arg).length}\r\n${arg}\r\n`;
    }
    return cmd;
  }

  private async readResponse(): Promise<unknown> {
    const typeByte = await this.readBytes(1);
    const type = this.decoder.decode(typeByte);

    switch (type) {
      case RESP_SIMPLE_STRING:
        return await this.readLine();
      case RESP_ERROR:
        throw new Error(await this.readLine());
      case RESP_INTEGER:
        return parseInt(await this.readLine(), 10);
      case RESP_BULK_STRING:
        return await this.readBulkString();
      case RESP_ARRAY:
        return await this.readArray();
      default:
        throw new Error(`Unknown RESP type: ${type}`);
    }
  }

  private async readBytes(n: number): Promise<Uint8Array> {
    const result = new Uint8Array(n);
    let offset = 0;

    while (offset < n) {
      const chunk = await this.conn!.read(result.subarray(offset));
      if (chunk === null) {
        throw new Error("Connection closed unexpectedly");
      }
      offset += chunk;
    }

    return result;
  }

  private async readLine(): Promise<string> {
    const bytes: number[] = [];

    while (true) {
      const buf = await this.readBytes(1);
      if (buf[0] === CR) {
        await this.readBytes(1); // consume \n
        break;
      }
      bytes.push(buf[0]!);
    }

    return this.decoder.decode(new Uint8Array(bytes));
  }

  private async readBulkString(): Promise<string | null> {
    const len = parseInt(await this.readLine(), 10);
    if (len === RESP_NULL_LENGTH) return null;

    const data = await this.readBytes(len);
    await this.readBytes(CRLF_LENGTH);
    return this.decoder.decode(data);
  }

  private async readArray(): Promise<unknown[] | null> {
    const count = parseInt(await this.readLine(), 10);
    if (count === RESP_NULL_LENGTH) return null;

    const result: unknown[] = [];
    for (let i = 0; i < count; i++) {
      result.push(await this.readResponse());
    }
    return result;
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

      if (Date.now() >= entry.expiresAt) {
        await this.client.del(this.key(key));
        this.misses++;
        return null;
      }

      this.hits++;
      return entry;
    } catch (error) {
      console.error("[RedisCache] Get error:", error);
      // Reset connection state so next operation will attempt to reconnect
      this.connected = false;
      this.misses++;
      throw error; // Propagate error so ResilientCache can handle fallback
    }
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    try {
      await this.ensureConnected();
      const ttlMs = entry.expiresAt - Date.now();
      const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
      await this.client.set(this.key(key), JSON.stringify(entry), ttlSeconds);
    } catch (error) {
      console.error("[RedisCache] Set error:", error);
      this.connected = false;
      throw error; // Propagate error so ResilientCache can handle fallback
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client.del(this.key(key));
    } catch (error) {
      console.error("[RedisCache] Delete error:", error);
      this.connected = false;
      throw error; // Propagate error so ResilientCache can handle fallback
    }
  }

  async clear(): Promise<void> {
    try {
      await this.ensureConnected();

      const pattern = `${this.prefix}*`;
      let cursor = "0";
      let totalDeleted = 0;

      do {
        const [nextCursor, keys] = await this.client.scan(cursor, pattern);
        cursor = nextCursor;

        if (keys.length > 0) {
          totalDeleted += await this.client.del(...keys);
        }
      } while (cursor !== "0");

      if (totalDeleted > 0) {
        console.log(`[RedisCache] Cleared ${totalDeleted} keys`);
      }

      this.hits = 0;
      this.misses = 0;
    } catch (error) {
      console.error("[RedisCache] Clear error:", error);
      this.connected = false;
      throw error; // Propagate error so ResilientCache can handle fallback
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      await this.ensureConnected();
      return await this.client.exists(this.key(key));
    } catch (error) {
      console.error("[RedisCache] Has error:", error);
      this.connected = false;
      throw error; // Propagate error so ResilientCache can handle fallback
    }
  }

  async stats(): Promise<CacheStats> {
    let size = 0;
    try {
      await this.ensureConnected();
      size = await this.client.dbsize();
    } catch (error) {
      // Reset connection state but don't throw for stats
      this.connected = false;
      console.warn("[RedisCache] Stats error:", error);
    }

    return { hits: this.hits, misses: this.misses, size, type: "redis" };
  }

  close(): Promise<void> {
    this.client.close();
    this.connected = false;
    return Promise.resolve();
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
      console.log("[RedisCache] Connected");
    }
  }
}
