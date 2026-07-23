import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";

async function withStore(
  fn: (store: MemoryRateLimitStore) => Promise<void> | void,
): Promise<void> {
  const store = new MemoryRateLimitStore(999999);
  try {
    await fn(store);
  } finally {
    store.destroy();
  }
}

describe("security/rate-limit/memory-store", () => {
  it("rejects cleanup intervals that can create a hot timer loop", () => {
    for (const interval of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => new MemoryRateLimitStore(interval),
        TypeError,
        "positive safe integer",
      );
    }
  });

  describe("MemoryRateLimitStore", () => {
    it("should increment and return count", () =>
      withStore(async (store) => {
        assertEquals(await store.increment("key1"), 1);
        assertEquals(await store.increment("key1"), 2);
        assertEquals(await store.increment("key1"), 3);
      }));

    it("should get current count", () =>
      withStore(async (store) => {
        assertEquals(await store.get("key1"), 0);
        await store.increment("key1");
        assertEquals(await store.get("key1"), 1);
      }));

    it("should reset a key", () =>
      withStore(async (store) => {
        await store.increment("key1");
        await store.increment("key1");
        await store.reset("key1");
        assertEquals(await store.get("key1"), 0);
      }));

    it("should reset all keys", () =>
      withStore(async (store) => {
        await store.increment("key1");
        await store.increment("key2");
        await store.resetAll();
        assertEquals(await store.get("key1"), 0);
        assertEquals(await store.get("key2"), 0);
      }));

    it("should track store size", () =>
      withStore(async (store) => {
        assertEquals(store.size(), 0);
        await store.increment("key1");
        assertEquals(store.size(), 1);
        await store.increment("key2");
        assertEquals(store.size(), 2);
      }));

    it("should track independent keys", () =>
      withStore(async (store) => {
        await store.increment("a");
        await store.increment("b");
        await store.increment("a");
        assertEquals(await store.get("a"), 2);
        assertEquals(await store.get("b"), 1);
      }));

    it("should support getState and setState", () =>
      withStore((store) => {
        assertEquals(store.getState("key1"), undefined);
        store.setState("key1", {
          count: 5,
          resetTime: Date.now() + 60000,
        });
        assertEquals(store.getState("key1")?.count, 5);
      }));

    it("should clean up interval on destroy", () => {
      const store = new MemoryRateLimitStore(999999);
      store.destroy();
      store.destroy();
    });

    it("cleans expired entries without keeping an idle interval alive", async () => {
      const store = new MemoryRateLimitStore(2);
      try {
        await store.increment("short-lived", 5);
        await new Promise((resolve) => setTimeout(resolve, 20));
        assertEquals(store.size(), 0);
      } finally {
        store.destroy();
      }
    });

    it("rejects malformed direct state updates", () =>
      withStore((store) => {
        for (
          const state of [
            { count: Number.NaN, resetTime: Date.now() + 1_000 },
            { count: -1, resetTime: Date.now() + 1_000 },
            { count: 1, resetTime: Number.POSITIVE_INFINITY },
          ]
        ) {
          assertThrows(
            () => store.setState("invalid", state),
            TypeError,
            "Rate limit state",
          );
        }
      }));
  });
});
