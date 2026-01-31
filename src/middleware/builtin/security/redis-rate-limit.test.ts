import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RedisRateLimitStore } from "./redis-rate-limit.ts";

function createMockRedisClient(): {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  incr: (key: string) => Promise<number>;
  pExpire: (key: string, ms: number) => Promise<boolean>;
  pTTL: (key: string) => Promise<number>;
  del: (key: string) => Promise<number>;
  on: () => void;
  _store: Map<string, { count: number; ttl: number }>;
} {
  const store = new Map<string, { count: number; ttl: number }>();

  return {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    incr: (key: string) => {
      const entry = store.get(key) ?? { count: 0, ttl: -1 };
      entry.count += 1;
      store.set(key, entry);
      return Promise.resolve(entry.count);
    },
    pExpire: (key: string, ms: number) => {
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
    on: () => {},
    _store: store,
  };
}

function createStoreWithMock(
  options?: { keyPrefix?: string },
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
    });

    describe("ensureClient", () => {
      it("should reuse existing client", async () => {
        const { rateStore, mockClient } = createStoreWithMock();
        await rateStore.increment("a", 1000);
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, mockClient);
      });
    });
  });
});
