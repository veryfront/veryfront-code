import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_BATCH_SIZE } from "#veryfront/utils/constants/limits.ts";
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

    it("flushes queued work before the request scope closes", async () => {
      const backend = createMockBackend({ queued: "value" });
      let queued!: Promise<string | null>;

      await runWithCacheBatching(() => {
        queued = getCachedWithBatching(backend, "queued");
        return Promise.resolve();
      });

      assertEquals(await queued, "value");
    });

    it("waits for an already-running threshold flush before closing", async () => {
      let releaseBatch!: () => void;
      let markBatchStarted!: () => void;
      const batchStarted = new Promise<void>((resolve) => {
        markBatchStarted = resolve;
      });
      const batchRelease = new Promise<void>((resolve) => {
        releaseBatch = resolve;
      });
      const backend = createMockBackend();
      backend.getBatch = async (keys) => {
        markBatchStarted();
        await batchRelease;
        return new Map(keys.map((key) => [key, key]));
      };

      const pending: Array<Promise<string | null>> = [];
      let scopeResolved = false;
      const scope = runWithCacheBatching(() => {
        for (let index = 0; index < MAX_BATCH_SIZE; index++) {
          pending.push(getCachedWithBatching(backend, `key-${index}`));
        }
        return Promise.resolve();
      }).then(() => {
        scopeResolved = true;
      });

      await batchStarted;
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(scopeResolved, false);

      releaseBatch();
      await scope;
      assertEquals((await Promise.all(pending)).length, MAX_BATCH_SIZE);
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
      // deno-lint-ignore require-await
      await runWithCacheBatching(async () => {
        setInRequestCache("key1", "value1");
        setInRequestCache("key2", "value2");

        const stats = getRequestCacheStats();
        assertExists(stats);
        assertEquals(stats.stored, 2);
      });
    });

    it("bounds stored entries across all backends in one request", async () => {
      const left = createMockBackend();
      const right = createMockBackend();

      await runWithCacheBatching(async () => {
        await Promise.all([
          ...Array.from(
            { length: 501 },
            (_, index) => getCachedWithBatching(left, `left-${index}`),
          ),
          ...Array.from(
            { length: 501 },
            (_, index) => getCachedWithBatching(right, `right-${index}`),
          ),
        ]);

        assertEquals(getRequestCacheStats()?.stored, 1_000);
      });
    });
  });

  describe("setInRequestCache", () => {
    it("should be a no-op outside of batching context", () => {
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
        setInRequestCache("key1", "cached-value");

        const result = await getCachedWithBatching(backend, "key1");
        assertEquals(result, "cached-value");
        assertEquals(backend.getCalls.length, 0);
        assertEquals(backend.getBatchCalls.length, 0);
      });
    });

    it("should return null from request cache when explicitly set to null", async () => {
      const backend = createMockBackend({ key1: "backend-value" });

      await runWithCacheBatching(async () => {
        setInRequestCache("key1", null);

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

    it("bounds stalled pending work and never exceeds the backend batch limit", async () => {
      const backend = createMockBackend();
      let releaseBatches!: () => void;
      const batchRelease = new Promise<void>((resolve) => {
        releaseBatches = resolve;
      });
      backend.getBatch = async (keys) => {
        backend.getBatchCalls.push([...keys]);
        await batchRelease;
        return new Map(keys.map((key) => [key, key]));
      };

      await runWithCacheBatching(async () => {
        const accepted = Array.from(
          { length: 2000 },
          (_, index) => getCachedWithBatching(backend, `key-${index}`),
        );
        let overflowRejected = false;
        const overflow = getCachedWithBatching(backend, "overflow").catch(() => {
          overflowRejected = true;
          return null;
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        const rejectedBeforeRelease = overflowRejected;
        releaseBatches();
        await Promise.all([...accepted, overflow]);

        assertEquals(rejectedBeforeRelease, true);
        assertEquals(
          backend.getBatchCalls.every((keys) => keys.length <= MAX_BATCH_SIZE),
          true,
        );
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
        assertEquals(getRequestCacheStats()?.hits, 1);
      });
    });

    it("isolates identical keys owned by different backends", async () => {
      const left = createMockBackend({ shared: "left-value" });
      const right = createMockBackend({ shared: "right-value" });

      await runWithCacheBatching(async () => {
        const [leftValue, rightValue] = await Promise.all([
          getCachedWithBatching(left, "shared"),
          getCachedWithBatching(right, "shared"),
        ]);

        assertEquals(leftValue, "left-value");
        assertEquals(rightValue, "right-value");
        assertEquals(left.getCalls, ["shared"]);
        assertEquals(right.getCalls, ["shared"]);
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
