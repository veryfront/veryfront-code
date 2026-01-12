/**
 * Node.js Redis Adapter
 *
 * Adapter for the Node.js 'redis' package.
 *
 * @module ai/workflow/backends/redis/adapters/node
 */

import type { NodeRedisClient } from "../types.ts";
import type { RedisAdapter } from "./interface.ts";

/**
 * Adapter for Node.js 'redis' package
 */
export class NodeRedisAdapter implements RedisAdapter {
  constructor(private client: NodeRedisClient) {}

  async hset(key: string, fields: Record<string, string>): Promise<number | string> {
    return await this.client.hSet(key, fields);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return await this.client.hGetAll(key);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return await this.client.hDel(key, fields);
  }

  async del(...keys: string[]): Promise<number> {
    return await this.client.del(keys);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return await this.client.sAdd(key, members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return await this.client.sRem(key, members);
  }

  async smembers(key: string): Promise<string[]> {
    return await this.client.sMembers(key);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    return await this.client.rPush(key, values);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return await this.client.lRange(key, start, stop);
  }

  async lindex(key: string, index: number): Promise<string | null> {
    return await this.client.lIndex(key, index);
  }

  async lset(key: string, index: number, value: string): Promise<string | "OK"> {
    return await this.client.lSet(key, index, value);
  }

  async llen(key: string): Promise<number> {
    return await this.client.lLen(key);
  }

  async xadd(key: string, id: string, fields: Record<string, string>): Promise<string> {
    return await this.client.xAdd(key, id, fields);
  }

  async xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<string> {
    return await this.client.xGroupCreate(key, group, id, { MKSTREAM: mkstream });
  }

  async xreadgroup(
    streams: Array<{ key: string; xid: string }>,
    options: { group: string; consumer: string; block?: number; count?: number },
  ): Promise<
    Array<{ key: string; messages: Array<{ id: string; data: Record<string, string> }> }>
  > {
    // Node redis format: { key: string, messages: Array<{ id: string, message: Record<string, string> }> }
    // OR if single stream: Array<{ id: string, message: Record<string, string> }> ??
    // The node-redis v4 API is slightly different.
    // Assuming commandOptions style:
    const result = await this.client.xReadGroup(
      options.group,
      options.consumer,
      streams.map((s) => ({ key: s.key, id: s.xid })),
      {
        BLOCK: options.block,
        COUNT: options.count,
      },
    );

    if (!result) return [];

    // Normalize output
    // node-redis v4 returns: Array<{ name: string, messages: Array<{ id: string, message: Record<string, string> }> }>
    return result.map((stream) => ({
      key: stream.name,
      messages: stream.messages.map((msg) => ({
        id: msg.id,
        data: msg.message,
      })),
    }));
  }

  async xack(key: string, group: string, ...ids: string[]): Promise<number> {
    return await this.client.xAck(key, group, ids);
  }

  async keys(pattern: string): Promise<string[]> {
    return await this.client.keys(pattern);
  }

  async exists(...keys: string[]): Promise<number> {
    return await this.client.exists(keys);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return await this.client.expire(key, seconds);
  }

  async set(
    key: string,
    value: string,
    options?: { nx?: boolean; px?: number; ex?: number },
  ): Promise<string | null> {
    const opts: { NX?: boolean; PX?: number; EX?: number } = {};
    if (options?.nx) opts.NX = true;
    if (options?.px) opts.PX = options.px;
    if (options?.ex) opts.EX = options.ex;
    return await this.client.set(key, value, opts);
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async quit(): Promise<void> {
    await this.client.quit();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }
}
