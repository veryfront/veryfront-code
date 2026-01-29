import { assertEquals, assertExists, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CacheBackend } from "./backend.ts";
import {
  getCachedWithBatching,
  getRequestCacheContext,
  getRequestCacheStats,
  runWithCacheBatching,
  setInRequestCache,
} from "./request-cache-batcher.ts";

/** Create a minimal mock CacheBackend backed by a Map. */
function createMockBackend(
  data: Record<string, string> = {},
): CacheBackend & { getCalls: string[]; getBatchCalls: string[][] } {
  const store = new Map(Object.entries(data));
  const getCalls: string[] = [];
  const getBatchCalls: string[][] = [];

  return {
    type: "memory",
    getCalls,
    getBatchCalls,
    get(key: string) {
      getCalls.push(key);
      return Promise.resolve(store.get(key) ?? null);
    },
    getBatch(keys: string[]) {
      getBatchCalls.push([...keys]);
      const results = new Map<string, string | null>();
      for (const key of keys) {
        results.set(key, store.get(key) ?? null);
      }
      return Promise.resolve(results);
    },
    set(_key: string, _value: string) {
      return Promise.resolve();
    },
    del(_key: string) {
      return Promise.resolve();
    },
  };
}

describe("cache/request-cache-batcher", () => {
  describe("runWithCacheBatching", () => {
    it("should execute the wrapped function and return its result", async () => {
      const result = await runWithCacheBatching(() => Promise.resolve(42));
      assertEquals(result, 42);
    });

    it("should propagate errors from the wrapped function", async () => {
      let caught: Error | null = null;
      try {
        await runWithCacheBatching(() => Promise.reject(new Error("test error")));
      } catch (e) {
        caught = e as Error;
      }
      assertNotEquals(caught, null);
      assertEquals(caught!.message, "test error");
    });
  });

  describe("getRequestCacheContext", () => {
    it("should return undefined outside of runWithCacheBatching", () => {
      assertEquals(getRequestCacheContext(), undefined);
    });

    it("should return context inside runWithCacheBatching", async () => {
      // deno-lint-ignore require-await
      await runWithCacheBatching(async () => {
        const ctx = getRequestCacheContext();
        assertNotEquals(ctx, undefined);
        assertExists(ctx);
        assertEquals(ctx.cache instanceof Map, true);
        assertEquals(ctx.pending instanceof Map, true);
      });
    });
  });

  describe("getRequestCacheStats", () => {
    it("should return null outside of batching context", () => {
      assertEquals(getRequestCacheStats(), null);
    });

    it("should return stats inside batching context", async () => {
      // deno-lint-ignore require-await
      await runWithCacheBatching(async () => {
        const stats = getRequestCacheStats();
        assertNotEquals(stats, null);
        assertExists(stats);
        assertEquals(stats.hits, 0);
        assertEquals(stats.stored, 0);
      });
    });

    it("should reflect stored entries count", async () => {
      // deno-lint-ignore require-await
      await runWithCacheBatching(async () => {
        setInRequestCache("key1", "value1");
        setInRequestCache("key2", "value2");
        const stats = getRequestCacheStats();
        assertExists(stats);
        assertEquals(stats.stored, 2);
      });
    });
  });

  describe("setInRequestCache", () => {
    it("should be a no-op outside of batching context", () => {
      // Should not throw
      setInRequestCache("key", "value");
    });

    it("should set value in the request cache", async () => {
      // deno-lint-ignore require-await
      await runWithCacheBatching(async () => {
        setInRequestCache("myKey", "myValue");
        const ctx = getRequestCacheContext();
        assertExists(ctx);
        assertEquals(ctx.cache.get("myKey"), "myValue");
      });
    });

    it("should allow null values", async () => {
      // deno-lint-ignore require-await
      await runWithCacheBatching(async () => {
        setInRequestCache("nullKey", null);
        const ctx = getRequestCacheContext();
        assertExists(ctx);
        assertEquals(ctx.cache.has("nullKey"), true);
        assertEquals(ctx.cache.get("nullKey"), null);
      });
    });
  });

  describe("getCachedWithBatching", () => {
    it("should fall back to direct backend.get outside of batching context", async () => {
      const backend = createMockBackend({ "key1": "value1" });
      const result = await getCachedWithBatching(backend, "key1");
      assertEquals(result, "value1");
      assertEquals(backend.getCalls.length, 1);
    });

    it("should return null for missing keys outside of context", async () => {
      const backend = createMockBackend({});
      const result = await getCachedWithBatching(backend, "missing");
      assertEquals(result, null);
    });

    it("should return cached value from request cache without hitting backend", async () => {
      const backend = createMockBackend({ "key1": "backend-value" });

      await runWithCacheBatching(async () => {
        setInRequestCache("key1", "cached-value");
        const result = await getCachedWithBatching(backend, "key1");
        assertEquals(result, "cached-value");
        // Backend should not have been called
        assertEquals(backend.getCalls.length, 0);
        assertEquals(backend.getBatchCalls.length, 0);
      });
    });

    it("should return null from request cache when explicitly set to null", async () => {
      const backend = createMockBackend({ "key1": "backend-value" });

      await runWithCacheBatching(async () => {
        setInRequestCache("key1", null);
        const result = await getCachedWithBatching(backend, "key1");
        assertEquals(result, null);
        assertEquals(backend.getCalls.length, 0);
      });
    });

    it("should batch multiple concurrent requests", async () => {
      const backend = createMockBackend({
        "a": "val-a",
        "b": "val-b",
        "c": "val-c",
      });

      await runWithCacheBatching(async () => {
        // Fire multiple requests concurrently - they should be batched
        const [ra, rb, rc] = await Promise.all([
          getCachedWithBatching(backend, "a"),
          getCachedWithBatching(backend, "b"),
          getCachedWithBatching(backend, "c"),
        ]);

        assertEquals(ra, "val-a");
        assertEquals(rb, "val-b");
        assertEquals(rc, "val-c");

        // Should have used getBatch since there are multiple keys
        assertEquals(backend.getBatchCalls.length, 1);
      });
    });

    it("should deduplicate requests for the same key", async () => {
      const backend = createMockBackend({ "dup": "dup-value" });

      await runWithCacheBatching(async () => {
        const [r1, r2] = await Promise.all([
          getCachedWithBatching(backend, "dup"),
          getCachedWithBatching(backend, "dup"),
        ]);

        assertEquals(r1, "dup-value");
        assertEquals(r2, "dup-value");
      });
    });

    it("should cache fetched values in the request context for subsequent reads", async () => {
      const backend = createMockBackend({ "cached-key": "fetched-value" });

      await runWithCacheBatching(async () => {
        // First call - triggers backend fetch
        const result1 = await getCachedWithBatching(backend, "cached-key");
        assertEquals(result1, "fetched-value");

        // Second call - should be served from request cache
        const totalCallsBefore = backend.getCalls.length + backend.getBatchCalls.length;
        const result2 = await getCachedWithBatching(backend, "cached-key");
        assertEquals(result2, "fetched-value");
        const totalCallsAfter = backend.getCalls.length + backend.getBatchCalls.length;

        // No additional backend calls for the second read
        assertEquals(totalCallsAfter, totalCallsBefore);
      });
    });

    it("should use individual gets when backend has no getBatch and single key", async () => {
      const store = new Map([["solo", "solo-val"]]);
      const getCalls: string[] = [];
      const backend: CacheBackend = {
        type: "memory",
        get(key: string) {
          getCalls.push(key);
          return Promise.resolve(store.get(key) ?? null);
        },
        set() {
          return Promise.resolve();
        },
        del() {
          return Promise.resolve();
        },
      };

      await runWithCacheBatching(async () => {
        const result = await getCachedWithBatching(backend, "solo");
        assertEquals(result, "solo-val");
        assertEquals(getCalls.length, 1);
      });
    });

    it("should handle backend errors by rejecting pending requests", async () => {
      const backend: CacheBackend = {
        type: "memory",
        get() {
          return Promise.reject(new Error("backend failure"));
        },
        set() {
          return Promise.resolve();
        },
        del() {
          return Promise.resolve();
        },
      };

      await runWithCacheBatching(async () => {
        let caught: Error | null = null;
        try {
          await getCachedWithBatching(backend, "fail-key");
        } catch (e) {
          caught = e as Error;
        }
        assertNotEquals(caught, null);
        assertEquals(caught!.message, "backend failure");
      });
    });
  });
});
