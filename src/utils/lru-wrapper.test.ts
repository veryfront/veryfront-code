import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { LRUCache } from "./lru-wrapper.ts";

describe("LRUCache", () => {
  const caches: LRUCache<unknown, unknown>[] = [];

  afterEach((): void => {
    while (caches.length) {
      caches.pop()?.destroy();
    }
  });

  function createCache<K, V>(
    options?: {
      maxEntries?: number;
      maxSizeBytes?: number;
      ttlMs?: number;
      cleanupIntervalMs?: number;
      onEvict?: (key: string, value: unknown) => void;
      estimateSizeOf?: (value: V) => number;
    },
  ): LRUCache<K, V> {
    const cache = new LRUCache<K, V>(options);
    caches.push(cache);
    return cache;
  }

  describe("Basic functionality", () => {
    it("basic set/get and overwrite", (): void => {
      const cache = createCache<string, number>({ maxEntries: 3, ttlMs: 1000 });

      cache.set("a", 1);
      cache.set("b", 2);
      assertEquals(cache.get("a"), 1);
      assertEquals(cache.get("b"), 2);

      cache.set("a", 3);
      assertEquals(cache.get("a"), 3);
    });

    it("get() on non-existent key", (): void => {
      const cache = createCache<string, string>({ maxEntries: 3 });
      assertEquals(cache.get("nonexistent"), undefined);
    });

    it("has() method without expiry", (): void => {
      const cache = createCache<string, string>({ maxEntries: 3 });
      cache.set("key1", "value1");

      assertEquals(cache.has("key1"), true);
      assertEquals(cache.has("nonexistent"), false);

      cache.delete("key1");
      assertEquals(cache.has("key1"), false);
    });

    it("delete() returns false for non-existent key", (): void => {
      const cache = createCache<string, string>({ maxEntries: 3 });

      assertEquals(cache.delete("nonexistent"), false);

      cache.set("exists", "value");
      assertEquals(cache.delete("exists"), true);
      assertEquals(cache.delete("exists"), false);
    });

    it("tracks membership for an undefined value", (): void => {
      const cache = createCache<string, undefined>({ maxEntries: 3 });

      cache.set("present", undefined);

      assertEquals(cache.get("present"), undefined);
      assertEquals(cache.has("present"), true);
      assertEquals(cache.delete("present"), true);
      assertEquals(cache.has("present"), false);
      assertEquals(cache.delete("present"), false);
    });

    it("clear and size", (): void => {
      const cache = createCache<number, string>({ maxEntries: 3, ttlMs: 1000 });

      cache.set(1, "one");
      cache.set(2, "two");
      cache.set(3, "three");

      cache.clear();
      assertEquals(cache.size, 0);
      assertEquals(cache.has(1), false);
      assertEquals(cache.has(2), false);
      assertEquals(cache.has(3), false);

      cache.set(4, "four");
      cache.set(5, "five");
      assertEquals(cache.size, 2);
      assertEquals(cache.get(4), "four");
      assertEquals(cache.get(5), "five");
    });
  });

  describe("TTL and expiration", () => {
    it("TTL expiration", async (): Promise<void> => {
      const cache = createCache<string, number>({ maxEntries: 3, ttlMs: 30 });

      cache.set("a", 1);
      assertEquals(cache.get("a"), 1);

      await delay(150);
      cache.cleanup();

      assertEquals(cache.get("a"), undefined);
    });

    it("has() respects expiry", async (): Promise<void> => {
      const cache = createCache<string, number>({ maxEntries: 3, ttlMs: 30 });

      cache.set("a", 1);
      assertEquals(cache.has("a"), true);

      await delay(150);
      cache.cleanup();

      assertEquals(cache.has("a"), false);
    });

    it("sweeps expired entries without a manual cleanup", async (): Promise<void> => {
      // shouldDisableInterval() fails on either signal, so both the global and
      // the env var the test tasks set must be cleared for this case.
      const previousEnv = getHostEnv("VF_DISABLE_LRU_INTERVAL");
      const globals = globalThis as Record<string, unknown>;
      const previousGlobal = globals.__vfDisableLruInterval;
      deleteEnv("VF_DISABLE_LRU_INTERVAL");
      delete globals.__vfDisableLruInterval;

      // size/keys/entries all hide expired entries, so onEvict is the only
      // signal that separates "expired" from "actually reclaimed".
      const swept: string[] = [];
      const cache = new LRUCache<string, number>({
        maxEntries: 3,
        ttlMs: 10,
        cleanupIntervalMs: 20,
        onEvict: (key: string) => swept.push(key),
      });

      try {
        cache.set("a", 1);

        await waitFor(() => swept.length > 0, {
          message: "periodic cleanup did not reclaim the expired entry",
        });
        assertEquals(
          swept,
          ["a"],
          "the periodic sweep must reclaim expired entries without a manual cleanup() call",
        );

        cache.destroy();

        // After destroy() the sweep must be gone, so a fresh expired entry stays.
        cache.set("b", 2);
        await delay(60);
        assertEquals(swept, ["a"], "destroy() must stop the periodic sweep");
      } finally {
        cache.destroy();
        if (previousEnv === undefined) deleteEnv("VF_DISABLE_LRU_INTERVAL");
        else setEnv("VF_DISABLE_LRU_INTERVAL", previousEnv);
        if (previousGlobal === undefined) delete globals.__vfDisableLruInterval;
        else globals.__vfDisableLruInterval = previousGlobal;
      }
    });

    it("no TTL - entries never expire", async (): Promise<void> => {
      const cache = createCache<string, number>({ maxEntries: 5 });

      cache.set("a", 1);
      cache.set("b", 2);

      await delay(10);

      assertEquals(cache.get("a"), 1);
      assertEquals(cache.get("b"), 2);
    });
  });

  describe("LRU eviction", () => {
    it("uses the configured value-size estimator for byte-bound eviction", (): void => {
      const cache = createCache<string, { retainedBytes: number }>({
        maxEntries: 3,
        maxSizeBytes: 10,
        estimateSizeOf: (value) => value.retainedBytes,
      });

      cache.set("a", { retainedBytes: 6 });
      cache.set("b", { retainedBytes: 6 });

      assertEquals(cache.get("a"), undefined);
      assertEquals(cache.get("b"), { retainedBytes: 6 });
    });

    it("prune respects maxEntries (LRU order)", async (): Promise<void> => {
      const cache = createCache<string, number>({ maxEntries: 2, ttlMs: 1000 });

      cache.set("a", 1);
      await delay(2);

      cache.set("b", 2);
      await delay(2);

      cache.get("a");
      await delay(2);

      cache.set("c", 3);
      assertEquals(cache.get("b"), undefined);
      assertEquals(cache.get("a"), 1);
      assertEquals(cache.get("c"), 3);

      cache.get("c");
      await delay(2);

      cache.set("d", 4);
      assertEquals(cache.get("a"), undefined);
      assertEquals(cache.get("c"), 3);
      assertEquals(cache.get("d"), 4);
    });

    it("forwards onEvict to the adapter", (): void => {
      const evicted: Array<[string, unknown]> = [];
      const cache = createCache<string, string>({
        maxEntries: 1,
        onEvict: (key, value) => evicted.push([key, value]),
      });

      cache.set("a", "1");
      cache.set("b", "2");
      assertEquals(evicted, [["a", "1"]], "the wrapper must forward onEvict to the adapter");

      cache.delete("b");
      assertEquals(evicted.length, 2, "delete must also reach the forwarded onEvict");
    });

    it("prune with no expired entries", (): void => {
      const cache = createCache<string, number>({ maxEntries: 2 });

      cache.set("a", 1);
      cache.set("b", 2);
      assertEquals(cache.size, 2);

      cache.set("c", 3);
      assertEquals(cache.size, 2);
      assertEquals(cache.has("a"), false);
      assertEquals(cache.has("b"), true);
      assertEquals(cache.has("c"), true);
    });

    it("pruning with exactly maxEntries", (): void => {
      const cache = createCache<string, number>({ maxEntries: 3 });

      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      assertEquals(cache.size, 3);
      assertEquals(cache.has("a"), true);
      assertEquals(cache.has("b"), true);
      assertEquals(cache.has("c"), true);
    });

    it("pruning removes multiple expired entries", async (): Promise<void> => {
      const cache = createCache<string, number>({ maxEntries: 5, ttlMs: 30 });

      cache.set("exp1", 1);
      cache.set("exp2", 2);

      await delay(150);
      cache.cleanup();

      cache.set("new1", 10);
      cache.set("new2", 20);

      assertEquals(cache.has("exp1"), false);
      assertEquals(cache.has("exp2"), false);
      assertEquals(cache.get("new1"), 10);
      assertEquals(cache.get("new2"), 20);
    });
  });

  describe("Default options and edge cases", () => {
    it("default options", (): void => {
      const cache = createCache<string, number>();

      for (let i = 0; i < 150; i++) {
        cache.set(`key${i}`, i);
      }

      assertEquals(cache.size, 100);
      assertEquals(cache.get("key0"), undefined);
      assertEquals(cache.get("key49"), undefined);
      assertEquals(cache.get("key50"), 50);
      assertEquals(cache.get("key149"), 149);
    });

    it("edge case - key is undefined", (): void => {
      const cache = createCache<string | undefined, number>({ maxEntries: 3 });
      const key = undefined as any;

      cache.set(key, 42);
      assertEquals(cache.get(key), 42);
      assertEquals(cache.has(key), true);
      assertEquals(cache.delete(key), true);
    });

    it("has() respects delete and clear", (): void => {
      const cache = createCache<string, number>({ maxEntries: 3, ttlMs: 1000 });

      cache.set("b", 2);
      assertEquals(cache.delete("b"), true);
      assertEquals(cache.has("b"), false);

      cache.set("c", 3);
      cache.set("d", 4);
      assertEquals(cache.size, 2);

      cache.clear();
      assertEquals(cache.size, 0);
    });
  });
});
