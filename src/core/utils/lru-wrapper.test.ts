import { assert, assertEquals } from "std/assert/mod.ts";
import { afterEach, describe, it } from "std/testing/bdd.ts";
import { LRUCache } from "./lru-wrapper.ts";

describe("LRUCache", () => {
  const caches: LRUCache<unknown, unknown>[] = [];

  afterEach(() => {
    while (caches.length > 0) {
      const cache = caches.pop();
      cache?.destroy();
    }
  });

  function createCache<K, V>(
    options?: { maxEntries?: number; ttlMs?: number; cleanupIntervalMs?: number },
  ): LRUCache<K, V> {
    const cache = new LRUCache<K, V>(options);
    caches.push(cache as LRUCache<unknown, unknown>);
    return cache;
  }

  describe("Basic functionality", () => {
    it("basic set/get and overwrite", () => {
      const cache = createCache<string, number>({ maxEntries: 3, ttlMs: 1000 });
      cache.set("a", 1);
      cache.set("b", 2);
      assertEquals(cache.get("a"), 1);
      assertEquals(cache.get("b"), 2);
      cache.set("a", 3);
      assertEquals(cache.get("a"), 3);
    });

    it("get() on non-existent key", () => {
      const cache = createCache<string, string>({ maxEntries: 3 });
      assertEquals(cache.get("nonexistent"), undefined);
    });

    it("has() method without expiry", () => {
      const cache = createCache<string, string>({ maxEntries: 3 });
      cache.set("key1", "value1");

      assertEquals(cache.has("key1"), true);
      assertEquals(cache.has("nonexistent"), false);

      cache.delete("key1");
      assertEquals(cache.has("key1"), false);
    });

    it("delete() returns false for non-existent key", () => {
      const cache = createCache<string, string>({ maxEntries: 3 });
      assertEquals(cache.delete("nonexistent"), false);

      cache.set("exists", "value");
      assertEquals(cache.delete("exists"), true);
      assertEquals(cache.delete("exists"), false);
    });

    it("clear and size", () => {
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
    it("TTL expiration", async () => {
      const cache = createCache<string, number>({ maxEntries: 3, ttlMs: 50 });
      cache.set("a", 1);
      assertEquals(cache.get("a"), 1);

      await new Promise((r) => setTimeout(r, 80));

      cache.cleanup();

      assertEquals(cache.get("a"), undefined);
    });

    it("has() respects expiry", async () => {
      const cache = createCache<string, number>({ maxEntries: 3, ttlMs: 50 });
      cache.set("a", 1);
      assertEquals(cache.has("a"), true);

      await new Promise((r) => setTimeout(r, 80));

      cache.cleanup();

      assertEquals(cache.has("a"), false);
    });

    it("no TTL - entries never expire", async () => {
      const cache = createCache<string, number>({ maxEntries: 5 });
      cache.set("a", 1);
      cache.set("b", 2);

      await new Promise((resolve) => {
        setTimeout(() => {
          assertEquals(cache.get("a"), 1);
          assertEquals(cache.get("b"), 2);
          resolve(undefined);
        }, 10);
      });
    });
  });

  describe("LRU eviction", () => {
    it("prune respects maxEntries (LRU order)", async () => {
      const cache = createCache<string, number>({ maxEntries: 2, ttlMs: 1000 });
      cache.set("a", 1);
      await new Promise((r) => setTimeout(r, 2));
      cache.set("b", 2);
      await new Promise((r) => setTimeout(r, 2));
      assert(cache.get("a") !== undefined);
      await new Promise((r) => setTimeout(r, 2));
      cache.set("c", 3);
      assertEquals(cache.get("b"), undefined);
      assertEquals(cache.get("a"), 1);
      assertEquals(cache.get("c"), 3);
      assert(cache.get("c") !== undefined);
      await new Promise((r) => setTimeout(r, 2));
      cache.set("d", 4);
      assertEquals(cache.get("a"), undefined);
      assertEquals(cache.get("c"), 3);
      assertEquals(cache.get("d"), 4);
    });

    it("prune with no expired entries", () => {
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

    it("pruning with exactly maxEntries", () => {
      const cache = createCache<string, number>({ maxEntries: 3 });
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      assertEquals(cache.size, 3);
      assertEquals(cache.has("a"), true);
      assertEquals(cache.has("b"), true);
      assertEquals(cache.has("c"), true);
    });

    it("pruning removes multiple expired entries", async () => {
      const cache = createCache<string, number>({ maxEntries: 5, ttlMs: 50 });

      cache.set("exp1", 1);
      cache.set("exp2", 2);

      await new Promise((r) => setTimeout(r, 80));

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
    it("default options", () => {
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

    it("edge case - key is undefined", () => {
      const cache = createCache<string | undefined, number>({ maxEntries: 3 });
      cache.set(undefined as any, 42);
      assertEquals(cache.get(undefined as any), 42);
      assertEquals(cache.has(undefined as any), true);
      assertEquals(cache.delete(undefined as any), true);
    });

    it("has() respects delete and clear", () => {
      const cache = createCache<string, number>({ maxEntries: 3, ttlMs: 1000 });
      cache.set("b", 2);
      assertEquals(cache.delete("b"), true);
      assertEquals(cache.has("b"), false);
      cache.set("c", 3);
      cache.set("d", 4);
      assertEquals(cache.size >= 1, true);
      cache.clear();
      assertEquals(cache.size, 0);
    });
  });
});
