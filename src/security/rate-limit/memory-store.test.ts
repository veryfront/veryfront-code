import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";

describe("security/rate-limit/memory-store", () => {
  describe("MemoryRateLimitStore", () => {
    it("should increment and return count", async () => {
      const store = new MemoryRateLimitStore(999999);
      try {
        assertEquals(await store.increment("key1"), 1);
        assertEquals(await store.increment("key1"), 2);
        assertEquals(await store.increment("key1"), 3);
      } finally {
        store.destroy();
      }
    });

    it("should get current count", async () => {
      const store = new MemoryRateLimitStore(999999);
      try {
        assertEquals(await store.get("key1"), 0);
        await store.increment("key1");
        assertEquals(await store.get("key1"), 1);
      } finally {
        store.destroy();
      }
    });

    it("should reset a key", async () => {
      const store = new MemoryRateLimitStore(999999);
      try {
        await store.increment("key1");
        await store.increment("key1");
        await store.reset("key1");
        assertEquals(await store.get("key1"), 0);
      } finally {
        store.destroy();
      }
    });

    it("should reset all keys", async () => {
      const store = new MemoryRateLimitStore(999999);
      try {
        await store.increment("key1");
        await store.increment("key2");
        await store.resetAll();
        assertEquals(await store.get("key1"), 0);
        assertEquals(await store.get("key2"), 0);
      } finally {
        store.destroy();
      }
    });

    it("should track store size", async () => {
      const store = new MemoryRateLimitStore(999999);
      try {
        assertEquals(store.size(), 0);
        await store.increment("key1");
        assertEquals(store.size(), 1);
        await store.increment("key2");
        assertEquals(store.size(), 2);
      } finally {
        store.destroy();
      }
    });

    it("should track independent keys", async () => {
      const store = new MemoryRateLimitStore(999999);
      try {
        await store.increment("a");
        await store.increment("b");
        await store.increment("a");
        assertEquals(await store.get("a"), 2);
        assertEquals(await store.get("b"), 1);
      } finally {
        store.destroy();
      }
    });

    it("should support getState and setState", () => {
      const store = new MemoryRateLimitStore(999999);
      try {
        assertEquals(store.getState("key1"), undefined);
        store.setState("key1", {
          count: 5,
          resetTime: Date.now() + 60000,
        });
        const state = store.getState("key1");
        assertEquals(state?.count, 5);
      } finally {
        store.destroy();
      }
    });

    it("should clean up interval on destroy", () => {
      const store = new MemoryRateLimitStore(999999);
      store.destroy();
      // Double destroy should not throw
      store.destroy();
    });
  });
});
