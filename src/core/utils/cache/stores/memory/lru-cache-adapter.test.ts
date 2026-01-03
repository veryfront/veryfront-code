import { describe, it, beforeEach } from "@std/testing/bdd.ts";
import { expect } from "@std/expect";
import { LRUCacheAdapter } from "./lru-cache-adapter.ts";

describe("LRUCacheAdapter", () => {
  let cache: LRUCacheAdapter;

  beforeEach(() => {
    cache = new LRUCacheAdapter({ maxEntries: 5, maxSizeBytes: 1024 });
  });

  describe("basic operations", () => {
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
      smallCache.set("d", "4"); // Should evict "a"

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

      // Access "a" to move it to front
      smallCache.get("a");

      // Now add "d" - should evict "b" (LRU)
      smallCache.set("d", "4");

      expect(smallCache.get("a")).toBe("1"); // Still exists
      expect(smallCache.get("b")).toBeUndefined(); // Evicted
      expect(smallCache.get("c")).toBe("3");
      expect(smallCache.get("d")).toBe("4");
    });
  });

  describe("TTL expiration", () => {
    it("should expire entries after TTL", async () => {
      cache.set("expire-me", "value", 50); // 50ms TTL

      expect(cache.get("expire-me")).toBe("value");

      await new Promise((r) => setTimeout(r, 60));

      expect(cache.get("expire-me")).toBeUndefined();
    });

    it("should use default TTL when not specified", () => {
      const cacheWithTtl = new LRUCacheAdapter({
        maxEntries: 10,
        ttlMs: 100,
      });

      cacheWithTtl.set("key", "value");
      expect(cacheWithTtl.get("key")).toBe("value");
    });

    it("should cleanup expired entries", async () => {
      cache.set("expire1", "value1", 30);
      cache.set("expire2", "value2", 30);
      cache.set("keep", "value3", 5000);

      await new Promise((r) => setTimeout(r, 50));

      const cleaned = cache.cleanupExpired();
      expect(cleaned).toBe(2);
      expect(cache.get("keep")).toBe("value3");
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

      const invalidated = cache.invalidateTag("tag-a");

      expect(invalidated).toBe(2);
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeUndefined();
      expect(cache.get("key3")).toBe("value3"); // Only had tag-b
    });

    it("should return 0 when invalidating non-existent tag", () => {
      const invalidated = cache.invalidateTag("nonexistent");
      expect(invalidated).toBe(0);
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
      const smallCache = new LRUCacheAdapter({
        maxEntries: 100,
        maxSizeBytes: 50, // Very small
      });

      smallCache.set("a", "12345678901234567890"); // ~40 bytes
      smallCache.set("b", "12345678901234567890"); // Should evict "a"

      // Either "a" or "b" should be evicted due to size
      const stats = smallCache.getStats();
      expect(stats.sizeBytes).toBeLessThanOrEqual(50);
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
      callbackCache.set("c", "3"); // Should evict "a"

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
      cache.set("key", "value", 50); // Update with shorter TTL

      await new Promise((r) => setTimeout(r, 60));

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
});
