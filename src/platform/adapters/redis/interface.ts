/**
 * Standardized Redis Adapter Interface
 * Normalizes differences between Deno and Node Redis clients
 */
export interface RedisAdapter {
  hset(key: string, fields: Record<string, string>): Promise<number | string>;
  hgetall(key: string): Promise<Record<string, string>>;
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
  ): Promise<Array<{ key: string; messages: Array<{ id: string; data: Record<string, string> }> }>>;
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

  quit(): Promise<void>;
  disconnect(): Promise<void>;
}
