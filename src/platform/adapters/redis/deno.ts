import type { DenoRedisClient } from "./types.ts";
import type { RedisAdapter } from "./interface.ts";
import { arrayToObject } from "./utils.ts";

export class DenoRedisAdapter implements RedisAdapter {
  constructor(private client: DenoRedisClient) {}

  hset(key: string, fields: Record<string, string>): Promise<number | string> {
    return this.client.hset(key, fields);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const res = await this.client.hgetall(key);
    // Deno redis returns array [k1, v1, k2, v2]
    return arrayToObject(res);
  }

  hdel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hdel(key, ...fields);
  }

  del(...keys: string[]): Promise<number> {
    return this.client.del(...keys);
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  rpush(key: string, ...values: string[]): Promise<number> {
    return this.client.rpush(key, ...values);
  }

  lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  lindex(key: string, index: number): Promise<string | null> {
    return this.client.lindex(key, index);
  }

  lset(key: string, index: number, value: string): Promise<string | "OK"> {
    return this.client.lset(key, index, value);
  }

  llen(key: string): Promise<number> {
    return this.client.llen(key);
  }

  xadd(key: string, id: string, fields: Record<string, string>): Promise<string> {
    return this.client.xadd(key, id, fields);
  }

  xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<string> {
    return this.client.xgroupCreate(key, group, id, mkstream);
  }

  async xreadgroup(
    streams: Array<{ key: string; xid: string }>,
    options: { group: string; consumer: string; block?: number; count?: number },
  ): Promise<
    Array<{ key: string; messages: Array<{ id: string; data: Record<string, string> }> }>
  > {
    if (streams.length === 0) return [];

    const res = await this.client.xreadgroup(
      streams.map(({ key, xid }) => ({ key, xid })),
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

  xack(key: string, group: string, ...ids: string[]): Promise<number> {
    return this.client.xack(key, group, ...ids);
  }

  keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  exists(...keys: string[]): Promise<number> {
    return this.client.exists(...keys);
  }

  expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  set(
    key: string,
    value: string,
    options?: { nx?: boolean; px?: number; ex?: number },
  ): Promise<string | null> {
    return this.client.set(key, value, options);
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async quit(): Promise<void> {
    await this.client.close(); // Deno redis uses close
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }
}
