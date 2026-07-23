import "#veryfront/schemas/_test-setup.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { delay } from "#std/async.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";
import { LRUCacheAdapter } from "./lru-cache-adapter.ts";
import { MAX_CACHE_TTL_MILLISECONDS } from "#veryfront/cache/backends/ttl.ts";

describe("LRUCacheAdapter", () => {
  let cache: LRUCacheAdapter;

  beforeEach(() => {
    cache = new LRUCacheAdapter({ maxEntries: 5, maxSizeBytes: 1024 });
  });

  describe("basic operations", () => {
    it("should reject invalid capacity limits", () => {
      for (
        const value of [
          0,
          -1,
          1.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.MAX_SAFE_INTEGER + 1,
        ]
      ) {
        assertThrows(() => new LRUCacheAdapter({ maxEntries: value }), RangeError);
        assertThrows(() => new LRUCacheAdapter({ maxSizeBytes: value }), RangeError);
      }
    });

    it("rejects invalid default and per-entry TTL values", () => {
      for (
        const value of [
          0,
          -1,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          MAX_CACHE_TTL_MILLISECONDS + 1,
        ]
      ) {
        assertThrows(() => new LRUCacheAdapter({ ttlMs: value }), RangeError);
        assertThrows(() => cache.set("key", "value", value), RangeError);
      }
    });

    it("requires custom size estimates to be finite non-negative integers", () => {
      for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const custom = new LRUCacheAdapter({ estimateSizeOf: () => value });
        assertThrows(() => custom.set("key", "value"), RangeError);
        expect(custom.getStats().entries).toBe(0);
      }

      const zeroSized = new LRUCacheAdapter({ estimateSizeOf: () => 0 });
      zeroSized.set("key", "value");
      expect(zeroSized.getStats().sizeBytes).toBe(0);
      expect(zeroSized.get("key")).toBe("value");
    });

    it("does not execute accessors while estimating object size", () => {
      let getterCalls = 0;
      const value = Object.defineProperty({}, "secret", {
        enumerable: true,
        get() {
          getterCalls++;
          return "sensitive";
        },
      });

      cache.set("accessor", value);

      expect(getterCalls).toBe(0);
      expect(cache.has("accessor")).toBe(true);
    });

    it("should store and retrieve values", () => {
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");
    });

    it("should return undefined for non-existent keys", () => {
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    it("should delete values", () => {
      cache.set("key1", "value1");
      cache.delete("key1");
      expect(cache.get("key1")).toBeUndefined();
    });

    it("should check if key exists with has()", () => {
      cache.set("key1", "value1");
      expect(cache.has("key1")).toBe(true);
      expect(cache.has("nonexistent")).toBe(false);
    });

    it("should distinguish a stored undefined value from a missing key", () => {
      cache.set("present", undefined);

      expect(cache.has("present")).toBe(true);
      expect(cache.has("missing")).toBe(false);
    });

    it("should clear all entries", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.clear();

      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeUndefined();
      expect(cache.getStats().entries).toBe(0);
    });

    it("should iterate over keys", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      const keys = Array.from(cache.keys());
      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
    });
  });

  describe("LRU eviction", () => {
    it("should evict least recently used entries when maxEntries exceeded", () => {
      const smallCache = new LRUCacheAdapter({ maxEntries: 3 });

      smallCache.set("a", "1");
      smallCache.set("b", "2");
      smallCache.set("c", "3");
      smallCache.set("d", "4");

      expect(smallCache.get("a")).toBeUndefined();
      expect(smallCache.get("b")).toBe("2");
      expect(smallCache.get("c")).toBe("3");
      expect(smallCache.get("d")).toBe("4");
    });

    it("should move accessed entries to front", () => {
      const smallCache = new LRUCacheAdapter({ maxEntries: 3 });

      smallCache.set("a", "1");
      smallCache.set("b", "2");
      smallCache.set("c", "3");

      smallCache.get("a");
      smallCache.set("d", "4");

      expect(smallCache.get("a")).toBe("1");
      expect(smallCache.get("b")).toBeUndefined();
      expect(smallCache.get("c")).toBe("3");
      expect(smallCache.get("d")).toBe("4");
    });
  });

  describe("TTL expiration", () => {
    it("should expire entries after TTL", async () => {
      cache.set("expire-me", "value", 50);
      expect(cache.get("expire-me")).toBe("value");

      await delay(300);

      expect(cache.get("expire-me")).toBeUndefined();
    });

    it("should use default TTL when not specified", () => {
      const cacheWithTtl = new LRUCacheAdapter({ maxEntries: 10, ttlMs: 100 });

      cacheWithTtl.set("key", "value");
      expect(cacheWithTtl.get("key")).toBe("value");
    });

    it("should cleanup expired entries", async () => {
      cache.set("expire1", "value1", 50);
      cache.set("expire2", "value2", 50);
      cache.set("keep", "value3", 5000);

      await delay(300);

      expect(cache.cleanupExpired()).toBe(2);
      expect(cache.get("keep")).toBe("value3");
    });

    it("expires entries exactly at their expiry timestamp", () => {
      const originalDateNow = Date.now;
      let now = originalDateNow();
      Date.now = () => now;
      try {
        cache.set("boundary", "value", 10);
        now += 10;
        expect(cache.has("boundary")).toBe(false);
      } finally {
        Date.now = originalDateNow;
      }
    });
  });

  describe("tag-based invalidation", () => {
    it("should associate entries with tags", () => {
      cache.set("key1", "value1", undefined, ["tag-a"]);
      cache.set("key2", "value2", undefined, ["tag-a", "tag-b"]);
      cache.set("key3", "value3", undefined, ["tag-b"]);

      expect(cache.get("key1")).toBe("value1");
      expect(cache.get("key2")).toBe("value2");
      expect(cache.get("key3")).toBe("value3");
    });

    it("should invalidate entries by tag", () => {
      cache.set("key1", "value1", undefined, ["tag-a"]);
      cache.set("key2", "value2", undefined, ["tag-a", "tag-b"]);
      cache.set("key3", "value3", undefined, ["tag-b"]);

      expect(cache.invalidateTag("tag-a")).toBe(2);
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeUndefined();
      expect(cache.get("key3")).toBe("value3");
    });

    it("should return 0 when invalidating non-existent tag", () => {
      expect(cache.invalidateTag("nonexistent")).toBe(0);
    });

    it("snapshots tags so caller mutation cannot leak index entries", () => {
      const tags = ["tag-a"];
      cache.set("key", "value", undefined, tags);
      tags[0] = "mutated";

      cache.delete("key");

      expect(cache.getStats().tags).toBe(0);
    });

    it("rejects tag sets that cannot be retained within fixed bounds", () => {
      assertThrows(
        () =>
          cache.set(
            "too-many-tags",
            "value",
            undefined,
            Array.from({ length: 101 }, (_, index) => `tag-${index}`),
          ),
        RangeError,
      );
      assertThrows(
        () => cache.set("long-tag", "value", undefined, ["x".repeat(257)]),
        RangeError,
      );
    });
  });

  describe("size management", () => {
    it("should track size correctly", () => {
      cache.set("key1", "short");
      const stats1 = cache.getStats();
      expect(stats1.sizeBytes).toBeGreaterThan(0);

      cache.set("key2", "a much longer string value");
      const stats2 = cache.getStats();
      expect(stats2.sizeBytes).toBeGreaterThan(stats1.sizeBytes);
    });

    it("should evict entries when maxSizeBytes exceeded", () => {
      const smallCache = new LRUCacheAdapter({ maxEntries: 100, maxSizeBytes: 50 });

      smallCache.set("a", "12345678901234567890");
      smallCache.set("b", "12345678901234567890");

      expect(smallCache.getStats().sizeBytes).toBeLessThanOrEqual(50);
    });

    it("accounts for Map, Set, and SharedArrayBuffer contents", () => {
      const sized = new LRUCacheAdapter({ maxEntries: 10, maxSizeBytes: 10_000 });
      sized.set("empty-map", new Map());
      const emptyMapSize = sized.getStats().sizeBytes;
      sized.clear();

      sized.set("map", new Map([["secret", "a".repeat(100)]]));
      expect(sized.getStats().sizeBytes).toBeGreaterThan(emptyMapSize);
      sized.clear();

      sized.set("empty-set", new Set());
      const emptySetSize = sized.getStats().sizeBytes;
      sized.clear();

      sized.set("set", new Set(["a".repeat(100)]));
      expect(sized.getStats().sizeBytes).toBeGreaterThan(emptySetSize);
      sized.clear();

      sized.set("shared", new SharedArrayBuffer(256));
      expect(sized.getStats().sizeBytes).toBeGreaterThanOrEqual(256);
    });
  });

  describe("stats", () => {
    it("should return accurate stats", () => {
      cache.set("key1", "value1", undefined, ["tag-a"]);
      cache.set("key2", "value2", undefined, ["tag-b"]);

      const stats = cache.getStats();

      expect(stats.entries).toBe(2);
      expect(stats.sizeBytes).toBeGreaterThan(0);
      expect(stats.maxEntries).toBe(5);
      expect(stats.maxSizeBytes).toBe(1024);
      expect(stats.tags).toBe(2);
    });
  });

  describe("onEvict callback", () => {
    it("should call onEvict when entry is evicted", () => {
      const evicted: Array<{ key: string; value: unknown }> = [];
      const callbackCache = new LRUCacheAdapter({
        maxEntries: 2,
        onEvict: (key, value) => {
          evicted.push({ key, value });
        },
      });

      callbackCache.set("a", "1");
      callbackCache.set("b", "2");
      callbackCache.set("c", "3");

      expect(evicted.length).toBe(1);
      expect(evicted[0]?.key).toBe("a");
      expect(evicted[0]?.value).toBe("1");
    });

    it("should call onEvict when entry is deleted", () => {
      const evicted: Array<{ key: string; value: unknown }> = [];
      const callbackCache = new LRUCacheAdapter({
        maxEntries: 10,
        onEvict: (key, value) => {
          evicted.push({ key, value });
        },
      });

      callbackCache.set("a", "1");
      callbackCache.delete("a");

      expect(evicted.length).toBe(1);
      expect(evicted[0]?.key).toBe("a");
    });

    it("should call onEvict for all entries on clear", () => {
      const evicted: string[] = [];
      const callbackCache = new LRUCacheAdapter({
        maxEntries: 10,
        onEvict: (key) => {
          evicted.push(key);
        },
      });

      callbackCache.set("a", "1");
      callbackCache.set("b", "2");
      callbackCache.clear();

      expect(evicted).toContain("a");
      expect(evicted).toContain("b");
    });

    it("should clear every entry when an onEvict callback throws", () => {
      const evicted: string[] = [];
      const callbackCache = new LRUCacheAdapter({
        maxEntries: 10,
        onEvict: (key) => {
          evicted.push(key);
          if (key === "a") throw new Error("onEvict error");
        },
      });

      callbackCache.set("a", "1");
      callbackCache.set("b", "2");
      callbackCache.clear();

      expect(evicted).toEqual(["a", "b"]);
      expect(callbackCache.getStats().entries).toBe(0);
      expect(callbackCache.getStats().sizeBytes).toBe(0);
    });
  });

  describe("update existing entry", () => {
    it("should update value for existing key", () => {
      cache.set("key", "original");
      cache.set("key", "updated");

      expect(cache.get("key")).toBe("updated");
      expect(cache.getStats().entries).toBe(1);
    });

    it("should update TTL for existing key", async () => {
      cache.set("key", "value", 1000);
      cache.set("key", "value", 50);

      await delay(300);

      expect(cache.get("key")).toBeUndefined();
    });
  });

  describe("various data types", () => {
    it("should handle null and undefined", () => {
      cache.set("null", null);
      cache.set("undefined", undefined);

      expect(cache.get("null")).toBeNull();
      expect(cache.get("undefined")).toBeUndefined();
    });

    it("should handle numbers and booleans", () => {
      cache.set("num", 42);
      cache.set("bool", true);

      expect(cache.get("num")).toBe(42);
      expect(cache.get("bool")).toBe(true);
    });

    it("should handle objects", () => {
      const obj = { foo: "bar", nested: { value: 123 } };
      cache.set("obj", obj);

      expect(cache.get("obj")).toEqual(obj);
    });

    it("should handle arrays", () => {
      const arr = [1, 2, 3, "four"];
      cache.set("arr", arr);

      expect(cache.get("arr")).toEqual(arr);
    });

    it("should handle Uint8Array", () => {
      const buffer = new Uint8Array([1, 2, 3, 4, 5]);
      cache.set("buffer", buffer);

      expect(cache.get("buffer")).toEqual(buffer);
    });
  });

  describe("onEvict error resilience", () => {
    it("should not corrupt size tracking when onEvict throws", () => {
      const throwingCache = new LRUCacheAdapter({
        maxEntries: 2,
        onEvict: () => {
          throw new Error("onEvict error");
        },
      });

      throwingCache.set("a", "value-a");
      throwingCache.set("b", "value-b");
      // This triggers eviction of "a" (oldest), onEvict throws but should be caught
      throwingCache.set("c", "value-c");

      // Cache should still function correctly
      expect(throwingCache.get("c")).toBe("value-c");
      const stats = throwingCache.getStats();
      expect(stats.entries).toBe(2);
      expect(stats.sizeBytes).toBeGreaterThan(0);
    });

    it("should maintain consistent size after onEvict throws during delete", () => {
      const throwingCache = new LRUCacheAdapter({
        maxEntries: 10,
        onEvict: () => {
          throw new Error("onEvict error");
        },
      });

      throwingCache.set("a", "value-a");
      const sizeBefore = throwingCache.getStats().sizeBytes;

      // delete calls onEvict which throws, but size should still be decremented
      throwingCache.delete("a");

      expect(throwingCache.getStats().entries).toBe(0);
      expect(throwingCache.getStats().sizeBytes).toBe(0);
      expect(sizeBefore).toBeGreaterThan(0);
    });
  });
});
