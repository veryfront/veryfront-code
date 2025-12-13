import { describe, it, beforeEach, afterEach } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";

describe("MemoryRateLimitStore", () => {
  let store: MemoryRateLimitStore;

  beforeEach(() => {
    store = new MemoryRateLimitStore();
  });

  afterEach(() => {
    store.destroy();
  });

  describe("increment", () => {
    it("should start at 1 for new key", async () => {
      const count = await store.increment("user:123");
      assertEquals(count, 1);
    });

    it("should increment existing key", async () => {
      await store.increment("user:123");
      const count = await store.increment("user:123");
      assertEquals(count, 2);
    });

    it("should handle multiple increments", async () => {
      await store.increment("user:123");
      await store.increment("user:123");
      const count = await store.increment("user:123");
      assertEquals(count, 3);
    });

    it("should track separate keys independently", async () => {
      await store.increment("user:123");
      await store.increment("user:123");
      const count456 = await store.increment("user:456");
      assertEquals(count456, 1);
      const count123 = await store.increment("user:123");
      assertEquals(count123, 3);
    });

    it("should reset count after reset time", async () => {
      await store.increment("user:123");
      await store.increment("user:123");

      // Manually set reset time to past
      const state = store.getState("user:123");
      if (state) {
        state.resetTime = Date.now() - 1000;
        store.setState("user:123", state);
      }

      const count = await store.increment("user:123");
      assertEquals(count, 1);
    });
  });

  describe("get", () => {
    it("should return 0 for non-existent key", async () => {
      const count = await store.get("user:999");
      assertEquals(count, 0);
    });

    it("should return current count", async () => {
      await store.increment("user:123");
      await store.increment("user:123");
      const count = await store.get("user:123");
      assertEquals(count, 2);
    });

    it("should return 0 for expired key", async () => {
      await store.increment("user:123");

      // Manually expire the key
      const state = store.getState("user:123");
      if (state) {
        state.resetTime = Date.now() - 1000;
        store.setState("user:123", state);
      }

      const count = await store.get("user:123");
      assertEquals(count, 0);
    });
  });

  describe("reset", () => {
    it("should reset specific key", async () => {
      await store.increment("user:123");
      await store.increment("user:123");
      await store.reset("user:123");
      const count = await store.get("user:123");
      assertEquals(count, 0);
    });

    it("should not affect other keys", async () => {
      await store.increment("user:123");
      await store.increment("user:456");
      await store.reset("user:123");
      const count456 = await store.get("user:456");
      assertEquals(count456, 1);
    });
  });

  describe("resetAll", () => {
    it("should reset all keys", async () => {
      await store.increment("user:123");
      await store.increment("user:456");
      await store.increment("user:789");
      await store.resetAll();

      const count123 = await store.get("user:123");
      const count456 = await store.get("user:456");
      const count789 = await store.get("user:789");

      assertEquals(count123, 0);
      assertEquals(count456, 0);
      assertEquals(count789, 0);
    });

    it("should allow new increments after reset", async () => {
      await store.increment("user:123");
      await store.resetAll();
      const count = await store.increment("user:123");
      assertEquals(count, 1);
    });
  });

  describe("state management", () => {
    it("should store and retrieve state", () => {
      const state = {
        count: 5,
        resetTime: Date.now() + 60000,
        requestTimestamps: [Date.now()],
      };
      store.setState("test:key", state);
      const retrieved = store.getState("test:key");
      assertEquals(retrieved, state);
    });

    it("should return undefined for non-existent state", () => {
      const state = store.getState("non:existent");
      assertEquals(state, undefined);
    });

    it("should update timestamps on increment", async () => {
      await store.increment("user:123");
      const state = store.getState("user:123");
      assert(state);
      assert(state.requestTimestamps);
      assertEquals(state.requestTimestamps.length, 1);

      await store.increment("user:123");
      const updatedState = store.getState("user:123");
      assert(updatedState);
      assert(updatedState.requestTimestamps);
      assertEquals(updatedState.requestTimestamps.length, 2);
    });
  });

  describe("size", () => {
    it("should return 0 for empty store", () => {
      assertEquals(store.size(), 0);
    });

    it("should return correct size", async () => {
      await store.increment("user:1");
      await store.increment("user:2");
      await store.increment("user:3");
      assertEquals(store.size(), 3);
    });

    it("should update size after reset", async () => {
      await store.increment("user:1");
      await store.increment("user:2");
      await store.reset("user:1");
      assertEquals(store.size(), 1);
    });
  });

  describe("cleanup", () => {
    it("should create with custom cleanup interval", () => {
      const customStore = new MemoryRateLimitStore(30000);
      assert(customStore);
      customStore.destroy();
    });

    it("should cleanup expired entries", async () => {
      await store.increment("user:1");
      await store.increment("user:2");

      // Expire one entry
      const state = store.getState("user:1");
      if (state) {
        state.resetTime = Date.now() - 1000;
        store.setState("user:1", state);
      }

      // Trigger cleanup manually by calling private method
      (store as unknown as { cleanup: () => void }).cleanup();

      assertEquals(store.size(), 1);
      const remaining = store.getState("user:2");
      assert(remaining);
    });
  });

  describe("destroy", () => {
    it("should cleanup interval on destroy", () => {
      const testStore = new MemoryRateLimitStore();
      testStore.destroy();
      // Should not throw
    });

    it("should allow multiple destroy calls", () => {
      const testStore = new MemoryRateLimitStore();
      testStore.destroy();
      testStore.destroy();
      // Should not throw
    });
  });
});
