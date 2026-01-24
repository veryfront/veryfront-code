export interface DenoRedisModule {
  connect(options: { hostname?: string; port?: number }): Promise<DenoRedisClient>;
}

export interface DenoRedisClient {
  hset(key: string, fields: Record<string, string>): Promise<number | string>;
  hgetall(key: string): Promise<string[]>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  rpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  lindex(key: string, index: number): Promise<string | null>;
  lset(key: string, index: number, value: string): Promise<string | "OK">;
  llen(key: string): Promise<number>;
  xadd(key: string, id: string, fields: Record<string, string>): Promise<string>;
  xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<string>;
  xreadgroup(
    streams: Array<{ key: string; xid: string }>,
    options: { group: string; consumer: string; block?: number; count?: number },
  ): Promise<Array<{ key: string; messages: Array<{ id: string; fieldValues: string[] }> }> | null>;
  xack(key: string, group: string, ...ids: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  exists(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  set(
    key: string,
    value: string,
    options?: { nx?: boolean; px?: number; ex?: number },
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  close(): Promise<void>;
}

export interface NodeRedisModule {
  createClient(
    options: { url?: string; socket?: { host?: string; port?: number } },
  ): NodeRedisClient;
}

export interface NodeRedisClient {
  connect(): Promise<void>;
  hSet(key: string, fields: Record<string, string>): Promise<number | string>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hDel(key: string, fields: string[]): Promise<number>;
  del(keys: string[]): Promise<number>;
  sAdd(key: string, members: string[]): Promise<number>;
  sRem(key: string, members: string[]): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  rPush(key: string, values: string[]): Promise<number>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  lIndex(key: string, index: number): Promise<string | null>;
  lSet(key: string, index: number, value: string): Promise<string | "OK">;
  lLen(key: string): Promise<number>;
  xAdd(key: string, id: string, fields: Record<string, string>): Promise<string>;
  xGroupCreate(
    key: string,
    group: string,
    id: string,
    options?: { MKSTREAM?: boolean },
  ): Promise<string>;
  xReadGroup(
    group: string,
    consumer: string,
    streams: Array<{ key: string; id: string }>,
    options?: { BLOCK?: number; COUNT?: number },
  ): Promise<
    Array<{ name: string; messages: Array<{ id: string; message: Record<string, string> }> }> | null
  >;
  xAck(key: string, group: string, ids: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  exists(keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  set(
    key: string,
    value: string,
    options?: { NX?: boolean; PX?: number; EX?: number },
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  quit(): Promise<void>;
  disconnect(): Promise<void>;
}
