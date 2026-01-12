/**
 * Deno Redis Adapter
 *
 * Adapter for the Deno 'redis' module.
 *
 * @module platform/adapters/redis/deno
 */

import type { DenoRedisClient } from "./types.ts";
import type { RedisAdapter } from "./interface.ts";
import { arrayToObject } from "./utils.ts";

/**
 * Adapter for Deno 'redis' module
 */
export class DenoRedisAdapter implements RedisAdapter {
  constructor(private client: DenoRedisClient) {}

  async hset(key: string, fields: Record<string, string>): Promise<number | string> {
    return await this.client.hset(key, fields);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const res = await this.client.hgetall(key);
    // Deno redis returns array [k1, v1, k2, v2]
    return arrayToObject(res);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return await this.client.hdel(key, ...fields);
  }

  async del(...keys: string[]): Promise<number> {
    return await this.client.del(...keys);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return await this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return await this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return await this.client.smembers(key);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    return await this.client.rpush(key, ...values);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return await this.client.lrange(key, start, stop);
  }

  async lindex(key: string, index: number): Promise<string | null> {
    return await this.client.lindex(key, index);
  }

  async lset(key: string, index: number, value: string): Promise<string | "OK"> {
    return await this.client.lset(key, index, value);
  }

  async llen(key: string): Promise<number> {
    return await this.client.llen(key);
  }

  async xadd(key: string, id: string, fields: Record<string, string>): Promise<string> {
    return await this.client.xadd(key, id, fields);
  }

  async xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<string> {
    return await this.client.xgroupCreate(key, group, id, mkstream);
  }

  async xreadgroup(
    streams: Array<{ key: string; xid: string }>,
    options: { group: string; consumer: string; block?: number; count?: number },
  ): Promise<
    Array<{ key: string; messages: Array<{ id: string; data: Record<string, string> }> }>
  > {
    if (streams.length === 0) return [];

    // Deno redis returns: Array<{ key: string, messages: Array<{ id: string, fieldValues: string[] }> }>
    const res = await this.client.xreadgroup(
      streams.map((s) => ({ key: s.key, xid: s.xid })),
      options,
    );

    if (!res) return [];

    return res.map((stream) => ({
      key: stream.key,
      messages: stream.messages.map((msg) => ({
        id: msg.id,
        data: arrayToObject(msg.fieldValues),
      })),
    }));
  }

  async xack(key: string, group: string, ...ids: string[]): Promise<number> {
    return await this.client.xack(key, group, ...ids);
  }

  async keys(pattern: string): Promise<string[]> {
    return await this.client.keys(pattern);
  }

  async exists(...keys: string[]): Promise<number> {
    return await this.client.exists(...keys);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return await this.client.expire(key, seconds);
  }

  async set(
    key: string,
    value: string,
    options?: { nx?: boolean; px?: number; ex?: number },
  ): Promise<string | null> {
    return await this.client.set(key, value, options);
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async quit(): Promise<void> {
    await this.client.close(); // Deno redis uses close
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }
}
