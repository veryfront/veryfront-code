import type { RedisAdapter } from "./interface.ts";
import type { NodeRedisClient } from "./types.ts";

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
    if (options?.px !== undefined && options.ex !== undefined) {
      throw new TypeError("Redis SET accepts either px or ex, not both");
    }
    if (
      options?.px !== undefined &&
      (!Number.isInteger(options.px) || options.px <= 0)
    ) {
      throw new RangeError("Redis SET px must be a positive integer");
    }
    if (
      options?.ex !== undefined &&
      (!Number.isInteger(options.ex) || options.ex <= 0)
    ) {
      throw new RangeError("Redis SET ex must be a positive integer");
    }

    const opts: { NX?: true; PX?: number; EX?: number } = {};
    if (options?.nx) opts.NX = true;
    if (options?.px !== undefined) opts.PX = options.px;
    if (options?.ex !== undefined) opts.EX = options.ex;

    return this.client.set(
      key,
      value,
      options?.nx || options?.px !== undefined || options?.ex !== undefined ? opts : undefined,
    );
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  // Redis server-side Lua (EVAL). Not JavaScript eval; runs the given script
  // atomically inside Redis for compare-and-delete / compare-and-pexpire.
  eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    return this.client.eval(script, { keys, arguments: args });
  }

  quit(): Promise<void> {
    // redis v5: quit() renamed to close()
    return this.client.close();
  }

  disconnect(): Promise<void> {
    // redis v5: disconnect() renamed to destroy()
    return this.client.destroy();
  }
}
