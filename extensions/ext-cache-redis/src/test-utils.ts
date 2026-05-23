/**
 * Test utilities for the ext-cache-redis extension.
 *
 * Exports an in-memory redis client stub sufficient for `RedisTokenCacheStore`
 * to exercise its full surface (`get`, `set`, `delete`, `scan`, `dbSize`,
 * `exists`, `setEx`, `del`, `close`) without a real redis server.
 *
 * PR 5 (integration tests) will import this helper directly.
 *
 * @module extensions/ext-cache-redis/test-utils
 */

// deno-lint-ignore-file no-explicit-any

/** Minimal subset of the redis-client interface used by RedisTokenCacheStore. */
export interface InMemoryRedisClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<"OK">;
  setEx(key: string, ttlSeconds: number, value: string): Promise<"OK">;
  del(keys: string | string[]): Promise<number>;
  exists(key: string): Promise<number>;
  dbSize(): Promise<number>;
  scan(
    cursor: string,
    opts: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: string; keys: string[] }>;
  on(event: string, handler: (err: unknown) => void): this;
  /** Test helper — exposes raw map for assertions. */
  _dump(): Map<string, { value: string; expiresAt: number | null }>;
  /** Test helper — emits redis client errors registered through `on("error")`. */
  _emitError(error: unknown): void;
}

function matchGlob(pattern: string, key: string): boolean {
  // Convert a minimal redis glob ("*") to a regex.
  const re = new RegExp(
    "^" +
      pattern
        .split("")
        .map((ch) => {
          if (ch === "*") return ".*";
          if (ch === "?") return ".";
          if (/[.+^${}()|[\]\\]/.test(ch)) return "\\" + ch;
          return ch;
        })
        .join("") +
      "$",
  );
  return re.test(key);
}

/**
 * Build a fresh in-memory redis stub. One stub per test.
 */
export function createInMemoryRedisStub(): InMemoryRedisClient {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const errorHandlers: Array<(err: unknown) => void> = [];

  function pruneExpired(key: string): void {
    const entry = store.get(key);
    if (!entry) return;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      store.delete(key);
    }
  }

  const client: InMemoryRedisClient = {
    async connect() {
      // no-op
    },
    async close() {
      store.clear();
    },
    async get(key) {
      pruneExpired(key);
      const entry = store.get(key);
      return entry ? entry.value : null;
    },
    async set(key, value) {
      store.set(key, { value, expiresAt: null });
      return "OK";
    },
    async setEx(key, ttlSeconds, value) {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return "OK";
    },
    async del(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      let count = 0;
      for (const k of list) {
        if (store.delete(k)) count++;
      }
      return count;
    },
    async exists(key) {
      pruneExpired(key);
      return store.has(key) ? 1 : 0;
    },
    async dbSize() {
      return store.size;
    },
    async scan(_cursor, opts) {
      const keys: string[] = [];
      const match = opts.MATCH ?? "*";
      for (const k of store.keys()) {
        if (matchGlob(match, k)) keys.push(k);
      }
      return { cursor: "0", keys };
    },
    on(event, handler) {
      if (event === "error") {
        errorHandlers.push(handler);
      }
      return client;
    },
    _dump() {
      return store;
    },
    _emitError(error) {
      for (const handler of errorHandlers) {
        handler(error);
      }
    },
  };

  return client;
}

/** Adapt `createInMemoryRedisStub` to the `RedisClientFactory` shape. */
export function createStubClientFactory(): {
  factory: (opts: Record<string, any>) => any;
  client: InMemoryRedisClient;
} {
  const client = createInMemoryRedisStub();
  return {
    factory: () => client as any,
    client,
  };
}
