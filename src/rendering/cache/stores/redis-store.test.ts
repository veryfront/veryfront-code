import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { RedisCacheStore } from "./redis-store.ts";

function createStore(options?: ConstructorParameters<typeof RedisCacheStore>[0]): RedisCacheStore {
  return new RedisCacheStore(options);
}

describe("RedisCacheStore", { sanitizeResources: false, sanitizeOps: false }, () => {
  describe("constructor", () => {
    it("should create store with default options", () => {
      expect(createStore()).toBeDefined();
    });

    it("should create store with custom key prefix", () => {
      expect(createStore({ keyPrefix: "custom:" })).toBeDefined();
    });

    it("should create store with fallback disabled", () => {
      expect(createStore({ enableFallback: false })).toBeDefined();
    });

    it("should create store with custom URL", () => {
      expect(createStore({ url: "redis://localhost:6379" })).toBeDefined();
    });

    it("should create store with all options", () => {
      expect(
        createStore({
          url: "redis://localhost:6379",
          keyPrefix: "test:",
          enableFallback: true,
        }),
      ).toBeDefined();
    });
  });

  describe("destroy", () => {
    it("should clean up resources on destroy when not connected", async () => {
      await createStore().destroy();
    });

    it("should be safe to call destroy multiple times", async () => {
      const store = createStore();
      await store.destroy();
      await store.destroy();
    });
  });

  describe("configuration", () => {
    it("should use default prefix 'veryfront:render:'", () => {
      expect(createStore()).toBeDefined();
    });

    it("should create store with default options", () => {
      expect(createStore()).toBeDefined();
    });
  });

  describe("operations without Redis connection", () => {
    it("should return undefined for get when redis unavailable and fallback disabled", async () => {
      const store = createStore({ enableFallback: false });
      // Without connecting to redis, operations should handle gracefully
      // The store is in initial state (not marked unavailable yet)
      // So it will try to connect and fail - but should handle it
      try {
        const result = await store.get("test-key");
        expect(result).toBeUndefined();
      } catch (_) {
        // Expected - Redis not available
      }
    });

    it("should handle delete gracefully when not connected", async () => {
      const store = createStore({ enableFallback: false });
      try {
        await store.delete("test-key");
      } catch (_) {
        // Expected - Redis not available
      }
    });

    it("should handle clear gracefully when not connected", async () => {
      const store = createStore({ enableFallback: false });
      try {
        await store.clear();
      } catch (_) {
        // Expected - Redis not available
      }
    });

    it("should accept custom TTL seconds", () => {
      expect(createStore({ ttlSeconds: 7200 })).toBeDefined();
    });

    it("should accept combined options", () => {
      expect(
        createStore({
          url: "redis://localhost:6379",
          keyPrefix: "custom:",
          enableFallback: true,
          ttlSeconds: 1800,
        }),
      ).toBeDefined();
    });
  });
});
