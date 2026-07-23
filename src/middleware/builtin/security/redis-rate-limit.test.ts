import "#veryfront/schemas/_test-setup.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { RedisRateLimitStore } from "./redis-rate-limit.ts";

function createMockRedisClient(): {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  eval: (
    script: string,
    options: { keys: string[]; arguments: string[] },
  ) => Promise<[number, number]>;
  incr: (key: string) => Promise<number>;
  pExpire: (key: string, ms: number) => Promise<boolean>;
  pTTL: (key: string) => Promise<number>;
  del: (key: string) => Promise<number>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  _emit: (event: string, ...args: unknown[]) => void;
  _evalCalls: number;
  _disconnectCalls: number;
  _incrCalls: number;
  _pExpireCalls: number;
  _store: Map<string, { count: number; ttl: number }>;
} {
  const store = new Map<string, { count: number; ttl: number }>();
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  let evalCalls = 0;
  let disconnectCalls = 0;
  let incrCalls = 0;
  let pExpireCalls = 0;

  return {
    connect: () => Promise.resolve(),
    disconnect: () => {
      disconnectCalls += 1;
      return Promise.resolve();
    },
    eval: (_script: string, options: { keys: string[]; arguments: string[] }) => {
      evalCalls += 1;
      const key = options.keys[0];
      if (!key) throw new Error("Expected eval key");
      const windowMs = Number(options.arguments[0]);
      const entry = store.get(key) ?? { count: 0, ttl: -1 };
      entry.count += 1;
      if (entry.ttl < 0) entry.ttl = windowMs;
      store.set(key, entry);
      return Promise.resolve([entry.count, entry.ttl]);
    },
    incr: (key: string) => {
      incrCalls += 1;
      const entry = store.get(key) ?? { count: 0, ttl: -1 };
      entry.count += 1;
      store.set(key, entry);
      return Promise.resolve(entry.count);
    },
    pExpire: (key: string, ms: number) => {
      pExpireCalls += 1;
      const entry = store.get(key);
      if (entry) entry.ttl = ms;
      return Promise.resolve(true);
    },
    pTTL: (key: string) => {
      const entry = store.get(key);
      return Promise.resolve(entry?.ttl ?? -2);
    },
    del: (key: string) => {
      const deleted = store.has(key) ? 1 : 0;
      store.delete(key);
      return Promise.resolve(deleted);
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(event) ?? [];
      eventListeners.push(listener);
      listeners.set(event, eventListeners);
    },
    _emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    get _evalCalls() {
      return evalCalls;
    },
    get _disconnectCalls() {
      return disconnectCalls;
    },
    get _incrCalls() {
      return incrCalls;
    },
    get _pExpireCalls() {
      return pExpireCalls;
    },
    _store: store,
  };
}

function createStoreWithMock(
  options?: { keyPrefix?: string; operationTimeoutMs?: number },
): {
  rateStore: RedisRateLimitStore;
  mockClient: ReturnType<typeof createMockRedisClient>;
} {
  const rateStore = new RedisRateLimitStore(options);
  const mockClient = createMockRedisClient();

  // deno-lint-ignore no-explicit-any
  (rateStore as any).client = mockClient;

  return { rateStore, mockClient };
}

function assert_reset_at_is_future(resetAt: number): void {
  assertEquals(resetAt > Date.now() - 1000, true);
}

describe("middleware/builtin/security/redis-rate-limit", () => {
  beforeEach(() => {
    setEnv("NODE_ENV", "test");
    deleteEnv("REDIS_URL");
  });

  describe("RedisRateLimitStore", () => {
    describe("constructor", () => {
      it("should use default key prefix", () => {
        const store = new RedisRateLimitStore();
        // deno-lint-ignore no-explicit-any
        assertEquals((store as any).keyPrefix, "veryfront:ratelimit:");
      });

      it("should accept custom key prefix", () => {
        const store = new RedisRateLimitStore({ keyPrefix: "custom:" });
        // deno-lint-ignore no-explicit-any
        assertEquals((store as any).keyPrefix, "custom:");
      });

      it("uses REDIS_URL when the URL option is omitted", () => {
        setEnv("REDIS_URL", "rediss://cache.example.test:6380");

        const store = new RedisRateLimitStore();

        // deno-lint-ignore no-explicit-any
        assertEquals((store as any).url, "rediss://cache.example.test:6380");
      });

      it("requires an explicit Redis URL in production", () => {
        setEnv("NODE_ENV", "production");

        assertThrows(
          () => new RedisRateLimitStore(),
          TypeError,
          "url or REDIS_URL is required in production",
        );
      });

      it("rejects unsafe key prefixes", () => {
        for (const keyPrefix of ["", "line\nbreak", "x".repeat(257)]) {
          assertThrows(
            () => new RedisRateLimitStore({ keyPrefix }),
            TypeError,
            "keyPrefix",
          );
        }
      });

      it("rejects malformed options and Redis URLs", () => {
        assertThrows(
          () => new RedisRateLimitStore(null as never),
          TypeError,
          "options",
        );
        assertThrows(
          () => new RedisRateLimitStore({ keyPrefix: 42 as never }),
          TypeError,
          "keyPrefix",
        );
        for (const url of ["", "https://example.com", "redis://host\nname"]) {
          assertThrows(
            () => new RedisRateLimitStore({ url }),
            TypeError,
            "url",
          );
        }
        for (const value of [0, 1.5, 120_001]) {
          assertThrows(
            () => new RedisRateLimitStore({ connectTimeoutMs: value }),
            TypeError,
            "connectTimeoutMs",
          );
          assertThrows(
            () => new RedisRateLimitStore({ operationTimeoutMs: value }),
            TypeError,
            "operationTimeoutMs",
          );
        }
      });
    });

    describe("increment", () => {
      it("should increment count for a new key", async () => {
        const { rateStore } = createStoreWithMock();
        const entry = await rateStore.increment("test-key", 60000);
        assertEquals(entry.count, 1);
        assert_reset_at_is_future(entry.resetAt);
      });

      it("should set expiry on first increment", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        await rateStore.increment("key1", 60000);
        const storedEntry = mockClient._store.get("veryfront:ratelimit:key1");
        assertEquals(storedEntry?.ttl, 60000);
      });

      it("should increment and set missing TTL in one Redis eval", async () => {
        const { rateStore, mockClient } = createStoreWithMock();

        const entry = await rateStore.increment("key1", 60000);

        assertEquals(entry.count, 1);
        assertEquals(mockClient._evalCalls, 1);
        assertEquals(mockClient._incrCalls, 0);
        assertEquals(mockClient._pExpireCalls, 0);
      });

      it("should increment count for existing key", async () => {
        const { rateStore } = createStoreWithMock();
        await rateStore.increment("key1", 60000);
        const entry = await rateStore.increment("key1", 60000);
        assertEquals(entry.count, 2);
      });

      it("should use custom key prefix", async () => {
        const { rateStore, mockClient } = createStoreWithMock({ keyPrefix: "app:" });
        await rateStore.increment("user-1", 30000);
        assertEquals(mockClient._store.has("app:user-1"), true);
      });

      it("should handle pTTL returning -1 by re-setting expiry", async () => {
        const { rateStore, mockClient } = createStoreWithMock();

        await rateStore.increment("key1", 60000);

        const stored = mockClient._store.get("veryfront:ratelimit:key1");
        if (!stored) throw new Error("Expected key to exist in mock store");
        stored.ttl = -1;

        const result = await rateStore.increment("key1", 60000);
        assertEquals(result.count, 2);

        const updated = mockClient._store.get("veryfront:ratelimit:key1");
        if (!updated) throw new Error("Expected key to exist in mock store");
        assertEquals(updated.ttl, 60000);
      });

      it("should return resetAt based on pTTL", async () => {
        const { rateStore } = createStoreWithMock();
        const before = Date.now();
        const entry = await rateStore.increment("key1", 60000);
        const diff = entry.resetAt - before;
        assertEquals(diff >= 59000 && diff <= 61000, true);
      });

      it("keeps far-future reset timestamps within the safe integer range", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        mockClient.eval = () => Promise.resolve([1, Number.MAX_SAFE_INTEGER]);

        const entry = await rateStore.increment("key1", Number.MAX_SAFE_INTEGER);

        assertEquals(entry.resetAt, Number.MAX_SAFE_INTEGER);
      });

      it("rejects invalid windows and malformed Redis results", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        await assertRejects(
          () => rateStore.increment("key", 0),
          TypeError,
          "windowMs",
        );
        mockClient.eval = () => Promise.resolve([1.5, 1000]);
        await assertRejects(
          () => rateStore.increment("key", 1000),
          Error,
          "invalid result",
        );
      });

      it("bounds stalled operations and releases the cached client", async () => {
        const { rateStore, mockClient } = createStoreWithMock({ operationTimeoutMs: 5 });
        mockClient.eval = () => new Promise(() => {});

        await assertRejects(
          () => rateStore.increment("key", 1000),
          Error,
          "timed out",
        );
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, null);
        assertEquals(mockClient._disconnectCalls, 1);
      });
    });

    describe("reset", () => {
      it("should delete the key from the store", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        await rateStore.increment("key1", 60000);
        assertEquals(mockClient._store.has("veryfront:ratelimit:key1"), true);

        await rateStore.reset("key1");
        assertEquals(mockClient._store.has("veryfront:ratelimit:key1"), false);
      });

      it("should not throw when resetting non-existent key", async () => {
        const { rateStore } = createStoreWithMock();
        await rateStore.reset("nonexistent");
      });
    });

    describe("destroy", () => {
      it("should disconnect the client", async () => {
        const { rateStore } = createStoreWithMock();
        await rateStore.destroy();
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, null);
      });

      it("should be safe to call when no client exists", async () => {
        const store = new RedisRateLimitStore();
        await store.destroy();
      });

      it("should be safe to call multiple times", async () => {
        const { rateStore } = createStoreWithMock();
        await rateStore.destroy();
        await rateStore.destroy();
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, null);
      });

      it("disconnects a connection that is still pending", async () => {
        const store = new RedisRateLimitStore();
        const client = createMockRedisClient();
        // deno-lint-ignore no-explicit-any
        (store as any).clientPromise = Promise.resolve(client);

        await store.destroy();

        assertEquals(client._disconnectCalls, 1);
      });

      it("does not reconnect after destruction", async () => {
        const { rateStore } = createStoreWithMock();
        await rateStore.destroy();

        await assertRejects(
          () => rateStore.increment("key", 1000),
          Error,
          "destroyed",
        );
      });
    });

    describe("ensureClient", () => {
      it("should reuse existing client", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        await rateStore.increment("a", 1000);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, mockClient);
      });

      it("should clear cached clients when redis emits error or end", () => {
        const { rateStore, mockClient } = createStoreWithMock();

        // deno-lint-ignore no-explicit-any
        (rateStore as any).attachClientLifecycleHandlers(mockClient);
        // deno-lint-ignore no-explicit-any
        (rateStore as any).clientPromise = Promise.resolve(mockClient);

        mockClient._emit("error", new Error("network partition"));
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, null);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).clientPromise, null);

        // deno-lint-ignore no-explicit-any
        (rateStore as any).client = mockClient;
        // deno-lint-ignore no-explicit-any
        (rateStore as any).clientPromise = Promise.resolve(mockClient);

        mockClient._emit("end");
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, null);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).clientPromise, null);
      });

      it("ignores lifecycle events from a replaced client", () => {
        const { rateStore, mockClient: previousClient } = createStoreWithMock();
        const currentClient = createMockRedisClient();
        // deno-lint-ignore no-explicit-any
        (rateStore as any).attachClientLifecycleHandlers(previousClient);
        // deno-lint-ignore no-explicit-any
        (rateStore as any).client = currentClient;

        previousClient._emit("end");

        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, currentClient);
      });
    });
  });
});
