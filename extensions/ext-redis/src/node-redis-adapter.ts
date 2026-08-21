import type { RedisAdapter } from "./redis-adapter.ts";
import type { NodeRedisClient } from "./node-redis-types.ts";

export class NodeRedisAdapter implements RedisAdapter {
  private transportClosed = false;
  private detachErrorListener?: () => void;
  private closePromise?: Promise<void>;

  constructor(
    private client: NodeRedisClient,
    detachErrorListener?: () => void,
  ) {
    this.detachErrorListener = detachErrorListener;
  }

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

  async xread(
    streams: Array<{ key: string; xid: string }>,
    options: { block?: number; count?: number } = {},
  ): Promise<
    Array<{ key: string; messages: Array<{ id: string; data: Record<string, string> }> }>
  > {
    const result = await this.client.xRead(
      streams.map((stream) => ({ key: stream.key, id: stream.xid })),
      { BLOCK: options.block, COUNT: options.count },
    );
    if (!result) return [];
    return result.map((stream) => ({
      key: stream.name,
      messages: stream.messages.map((message) => ({ id: message.id, data: message.message })),
    }));
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

  private performClose(close: () => Promise<void>): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const pending = this.closeTransport(close);
    this.closePromise = pending;
    void pending.catch(() => {
      if (this.closePromise === pending) this.closePromise = undefined;
    });
    return pending;
  }

  private async closeTransport(close: () => Promise<void>): Promise<void> {
    if (!this.transportClosed) {
      await close();
      this.transportClosed = true;
    }

    // Keep the callback when detaching fails so a subsequent destroy() retry
    // can finish listener cleanup without closing the transport twice.
    const detach = this.detachErrorListener;
    if (detach) {
      detach();
      this.detachErrorListener = undefined;
    }
  }

  quit(): Promise<void> {
    // redis v5: quit() renamed to close()
    return this.performClose(() => this.client.close());
  }

  disconnect(): Promise<void> {
    // redis v5: disconnect() renamed to destroy()
    return this.performClose(() => this.client.destroy());
  }
}
