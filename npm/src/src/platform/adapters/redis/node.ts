/**
 * Node.js Redis Adapter
 *
 * Adapter for the Node.js 'redis' package.
 *
 * @module platform/adapters/redis/node
 */

import type { RedisAdapter } from "./interface.js";
import type { NodeRedisClient } from "./types.js";

/**
 * Adapter for Node.js 'redis' package
 */
export class NodeRedisAdapter implements RedisAdapter {
  constructor(private client: NodeRedisClient) {}

  hset(key: string, fields: Record<string, string>): Promise<number | string> {
    return this.client.hSet(key, fields);
  }

  hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hGetAll(key);
  }

  hdel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hDel(key, fields);
  }

  del(...keys: string[]): Promise<number> {
    return this.client.del(keys);
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sAdd(key, members);
  }

  srem(key: string, ...members: string[]): Promise<number> {
    return this.client.sRem(key, members);
  }

  smembers(key: string): Promise<string[]> {
    return this.client.sMembers(key);
  }

  rpush(key: string, ...values: string[]): Promise<number> {
    return this.client.rPush(key, values);
  }

  lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lRange(key, start, stop);
  }

  lindex(key: string, index: number): Promise<string | null> {
    return this.client.lIndex(key, index);
  }

  lset(key: string, index: number, value: string): Promise<string | "OK"> {
    return this.client.lSet(key, index, value);
  }

  llen(key: string): Promise<number> {
    return this.client.lLen(key);
  }

  xadd(key: string, id: string, fields: Record<string, string>): Promise<string> {
    return this.client.xAdd(key, id, fields);
  }

  xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<string> {
    return this.client.xGroupCreate(key, group, id, { MKSTREAM: mkstream });
  }

  async xreadgroup(
    streams: Array<{ key: string; xid: string }>,
    options: { group: string; consumer: string; block?: number; count?: number },
  ): Promise<
    Array<{ key: string; messages: Array<{ id: string; data: Record<string, string> }> }>
  > {
    const result = await this.client.xReadGroup(
      options.group,
      options.consumer,
      streams.map((s) => ({ key: s.key, id: s.xid })),
      { BLOCK: options.block, COUNT: options.count },
    );

    if (!result) return [];

    // Normalize output
    // node-redis v4 returns: Array<{ name: string, messages: Array<{ id: string, message: Record<string, string> }> }>
    return result.map((stream) => ({
      key: stream.name,
      messages: stream.messages.map((msg) => ({ id: msg.id, data: msg.message })),
    }));
  }

  xack(key: string, group: string, ...ids: string[]): Promise<number> {
    return this.client.xAck(key, group, ids);
  }

  keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  exists(...keys: string[]): Promise<number> {
    return this.client.exists(keys);
  }

  expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  set(
    key: string,
    value: string,
    options?: { nx?: boolean; px?: number; ex?: number },
  ): Promise<string | null> {
    const opts: { NX?: true; PX?: number; EX?: number } = {};

    if (options?.nx) opts.NX = true;
    if (options?.px) opts.PX = options.px;
    if (options?.ex) opts.EX = options.ex;

    return this.client.set(key, value, opts);
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async quit(): Promise<void> {
    await this.client.quit();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }
}
