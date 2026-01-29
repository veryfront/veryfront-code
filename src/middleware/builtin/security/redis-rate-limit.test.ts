import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RedisRateLimitStore } from "./redis-rate-limit.ts";

/**
 * Creates a mock Redis client for testing without a real Redis connection.
 * We inject it by replacing the private client field after construction.
 */
function createMockRedisClient() {
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
      if (!entry) return Promise.resolve(-2);
      return Promise.resolve(entry.ttl);
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

/**
 * Injects a mock client into the RedisRateLimitStore, bypassing the
 * real Redis connection logic.
 */
function createStoreWithMock(options?: { keyPrefix?: string }) {
  const rateStore = new RedisRateLimitStore(options);
  const mockClient = createMockRedisClient();
  // Inject mock client via private field access
  // deno-lint-ignore no-explicit-any
  (rateStore as any).client = mockClient;
  return { rateStore, mockClient };
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
        const has = mockClient._store.has("app:user-1");
        assertEquals(has, true);
      });

      it("should handle pTTL returning -1 by re-setting expiry", async () => {
        const { rateStore, mockClient } = createStoreWithMock();

        // First increment sets count and TTL
        await rateStore.increment("key1", 60000);

        // Simulate TTL being removed (pTTL returns -1)
        const entry = mockClient._store.get("veryfront:ratelimit:key1")!;
        entry.ttl = -1;

        const result = await rateStore.increment("key1", 60000);
        assertEquals(result.count, 2);
        // After re-setting, TTL should be windowMs
        const updatedEntry = mockClient._store.get("veryfront:ratelimit:key1")!;
        assertEquals(updatedEntry.ttl, 60000);
      });

      it("should return resetAt based on pTTL", async () => {
        const { rateStore } = createStoreWithMock();
        const before = Date.now();
        const entry = await rateStore.increment("key1", 60000);
        // resetAt should be roughly now + 60000 (within 1000ms tolerance)
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
        // Should complete without error
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
        // No client connected, should not throw
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
        // First call
        await rateStore.increment("a", 1000);
        // Client should still be the same mock
        // deno-lint-ignore no-explicit-any
        assertEquals((rateStore as any).client, mockClient);
      });
    });
  });
});

function assert_reset_at_is_future(resetAt: number) {
  assertEquals(resetAt > Date.now() - 1000, true);
}
