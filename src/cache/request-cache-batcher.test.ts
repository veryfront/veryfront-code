import "#veryfront/schemas/_test-setup.ts";
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
    set() {
      return Promise.resolve();
    },
    del() {
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

    it("should finish queued reads when the callback returns without awaiting them", async () => {
      const backend = createMockBackend({ key: "value" });
      let pending!: Promise<string | null>;

      await runWithCacheBatching(async () => {
        pending = getCachedWithBatching(backend, "key");
      });

      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("queued read did not finish")), 100);
          }),
        ]);
        assertEquals(result, "value");
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    });

    it("should not resolve until queued reads have been flushed", async () => {
      let markBackendStarted!: () => void;
      const backendStarted = new Promise<void>((resolve) => {
        markBackendStarted = resolve;
      });
      let releaseBackend!: () => void;
      const backendReleased = new Promise<void>((resolve) => {
        releaseBackend = resolve;
      });
      const backend: CacheBackend = {
        type: "memory",
        async get() {
          markBackendStarted();
          await backendReleased;
          return "value";
        },
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
      };
      let pending!: Promise<string | null>;
      let wrapperSettled = false;

      const wrapped = runWithCacheBatching(async () => {
        pending = getCachedWithBatching(backend, "key");
      });
      void wrapped.then(() => {
        wrapperSettled = true;
      });

      await backendStarted;
      await Promise.resolve();
      assertEquals(wrapperSettled, false);

      releaseBackend();
      await wrapped;
      assertEquals(await pending, "value");
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
        assertExists(stats);
        assertEquals(stats.hits, 0);
        assertEquals(stats.stored, 0);
      });
    });

    it("should reflect stored entries count", async () => {
      const backend = createMockBackend();
      // deno-lint-ignore require-await
      await runWithCacheBatching(async () => {
        setInRequestCache(backend, "key1", "value1");
        setInRequestCache(backend, "key2", "value2");

        const stats = getRequestCacheStats();
        assertExists(stats);
        assertEquals(stats.stored, 2);
      });
    });
  });

  describe("setInRequestCache", () => {
    it("should be a no-op outside of batching context", () => {
      setInRequestCache(createMockBackend(), "key", "value");
    });

    it("should set value in the request cache", async () => {
      const backend = createMockBackend();
      // deno-lint-ignore require-await
      await runWithCacheBatching(async () => {
        setInRequestCache(backend, "myKey", "myValue");

        const ctx = getRequestCacheContext();
        assertExists(ctx);
        assertEquals(ctx.cache.get("myKey"), "myValue");
      });
    });

    it("should allow null values", async () => {
      const backend = createMockBackend();
      // deno-lint-ignore require-await
      await runWithCacheBatching(async () => {
        setInRequestCache(backend, "nullKey", null);

        const ctx = getRequestCacheContext();
        assertExists(ctx);
        assertEquals(ctx.cache.has("nullKey"), true);
        assertEquals(ctx.cache.get("nullKey"), null);
      });
    });

    it("bounds retained keys and generation metadata within one request", async () => {
      const backend = createMockBackend();
      // deno-lint-ignore require-await
      await runWithCacheBatching(async () => {
        for (let index = 0; index < 1_100; index++) {
          setInRequestCache(backend, `key-${index}`, `value-${index}`);
        }

        const ctx = getRequestCacheContext();
        assertExists(ctx);
        assertEquals(ctx.cache.size <= 1_000, true);
        assertEquals(ctx.explicitCacheKeys.size <= 1_000, true);
        assertEquals(ctx.generations.size <= 1_000, true);
      });
    });

    it("bounds backend-specific state within one request", async () => {
      const backends = Array.from({ length: 40 }, () => createMockBackend());
      // deno-lint-ignore require-await
      await runWithCacheBatching(async () => {
        for (const [index, backend] of backends.entries()) {
          setInRequestCache(backend, "key", `value-${index}`);
        }

        const ctx = getRequestCacheContext();
        assertExists(ctx);
        assertEquals(ctx.additionalBackends.size <= 31, true);
      });
    });
  });

  describe("getCachedWithBatching", () => {
    it("should fall back to direct backend.get outside of batching context", async () => {
      const backend = createMockBackend({ key1: "value1" });

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
      const backend = createMockBackend({ key1: "backend-value" });

      await runWithCacheBatching(async () => {
        setInRequestCache(backend, "key1", "cached-value");

        const result = await getCachedWithBatching(backend, "key1");
        assertEquals(result, "cached-value");
        assertEquals(backend.getCalls.length, 0);
        assertEquals(backend.getBatchCalls.length, 0);
      });
    });

    it("should return null from request cache when explicitly set to null", async () => {
      const backend = createMockBackend({ key1: "backend-value" });

      await runWithCacheBatching(async () => {
        setInRequestCache(backend, "key1", null);

        const result = await getCachedWithBatching(backend, "key1");
        assertEquals(result, null);
        assertEquals(backend.getCalls.length, 0);
      });
    });

    it("should batch multiple concurrent requests", async () => {
      const backend = createMockBackend({
        a: "val-a",
        b: "val-b",
        c: "val-c",
      });

      await runWithCacheBatching(async () => {
        const [ra, rb, rc] = await Promise.all([
          getCachedWithBatching(backend, "a"),
          getCachedWithBatching(backend, "b"),
          getCachedWithBatching(backend, "c"),
        ]);

        assertEquals(ra, "val-a");
        assertEquals(rb, "val-b");
        assertEquals(rc, "val-c");
        assertEquals(backend.getBatchCalls.length, 1);
      });
    });

    it("should deduplicate requests for the same key", async () => {
      const backend = createMockBackend({ dup: "dup-value" });

      await runWithCacheBatching(async () => {
        const [r1, r2] = await Promise.all([
          getCachedWithBatching(backend, "dup"),
          getCachedWithBatching(backend, "dup"),
        ]);

        assertEquals(r1, "dup-value");
        assertEquals(r2, "dup-value");
      });
    });

    it("should isolate identical keys across different backends", async () => {
      const firstBackend = createMockBackend({ shared: "first-value" });
      const secondBackend = createMockBackend({ shared: "second-value" });

      await runWithCacheBatching(async () => {
        const [first, second] = await Promise.all([
          getCachedWithBatching(firstBackend, "shared"),
          getCachedWithBatching(secondBackend, "shared"),
        ]);

        assertEquals(first, "first-value");
        assertEquals(second, "second-value");
        assertEquals(firstBackend.getCalls, ["shared"]);
        assertEquals(secondBackend.getCalls, ["shared"]);

        assertEquals(await getCachedWithBatching(firstBackend, "shared"), "first-value");
        assertEquals(await getCachedWithBatching(secondBackend, "shared"), "second-value");
      });
    });

    it("scopes explicit request writes to the backend that owns them", async () => {
      const firstBackend = createMockBackend({ shared: "first-backend" });
      const secondBackend = createMockBackend({ shared: "second-backend" });

      await runWithCacheBatching(async () => {
        setInRequestCache(firstBackend, "shared", "first-explicit");

        assertEquals(await getCachedWithBatching(firstBackend, "shared"), "first-explicit");
        assertEquals(await getCachedWithBatching(secondBackend, "shared"), "second-backend");
        assertEquals(firstBackend.getCalls, []);
        assertEquals(secondBackend.getCalls, ["shared"]);
      });
    });

    it("should cache fetched values in the request context for subsequent reads", async () => {
      const backend = createMockBackend({ "cached-key": "fetched-value" });

      await runWithCacheBatching(async () => {
        const result1 = await getCachedWithBatching(backend, "cached-key");
        assertEquals(result1, "fetched-value");

        const totalCallsBefore = backend.getCalls.length + backend.getBatchCalls.length;

        const result2 = await getCachedWithBatching(backend, "cached-key");
        assertEquals(result2, "fetched-value");

        const totalCallsAfter = backend.getCalls.length + backend.getBatchCalls.length;
        assertEquals(totalCallsAfter, totalCallsBefore);
      });
    });

    it("should not let a deferred backend read overwrite a newer request write", async () => {
      let markReadStarted!: () => void;
      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      let releaseRead!: () => void;
      const readReleased = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const backend: CacheBackend = {
        type: "memory",
        async get() {
          markReadStarted();
          await readReleased;
          return "stale-backend-value";
        },
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
      };

      await runWithCacheBatching(async () => {
        const pendingRead = getCachedWithBatching(backend, "shared-key");
        await readStarted;

        setInRequestCache(backend, "shared-key", "new-request-value");
        releaseRead();

        assertEquals(await pendingRead, "new-request-value");
        assertEquals(
          await getCachedWithBatching(backend, "shared-key"),
          "new-request-value",
        );
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

    it("should preserve requested keys when falling back to individual batch gets", async () => {
      const store = new Map([["a", "val-a"], ["c", "val-c"]]);
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
        const [a, b, c] = await Promise.all([
          getCachedWithBatching(backend, "a"),
          getCachedWithBatching(backend, "b"),
          getCachedWithBatching(backend, "c"),
        ]);

        assertEquals(a, "val-a");
        assertEquals(b, null);
        assertEquals(c, "val-c");
        assertEquals(getCalls, ["a", "b", "c"]);
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
