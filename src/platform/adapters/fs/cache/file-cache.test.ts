import { assertEquals, assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { FileCache, initializeFileCacheRedis, isFileCacheRedisEnabled } from "./file-cache.ts";

describe("FileCache", () => {
  let cache: FileCache;

  beforeEach(() => {
    cache = new FileCache();
  });

  afterEach(() => {
    cache.clear();
  });

  describe("class instantiation", () => {
    it("should be instantiable with default options", () => {
      const c = new FileCache();
      assertExists(c);
    });

    it("should be instantiable with custom options", () => {
      const c = new FileCache({
        enabled: true,
        ttl: 30000,
        maxSize: 500,
        maxMemory: 50 * 1024 * 1024,
      });
      assertExists(c);
    });
  });

  describe("get/set", () => {
    it("should set and get a value", () => {
      cache.set("key1", "value1");
      assertEquals(cache.get("key1"), "value1");
    });

    it("should return undefined for non-existent key", () => {
      assertEquals(cache.get("non-existent"), undefined);
    });

    it("should handle object values", () => {
      const obj = { foo: "bar", num: 123 };
      cache.set("obj-key", obj);
      assertEquals(cache.get("obj-key"), obj);
    });

    it("should handle Uint8Array values", () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      cache.set("bytes-key", bytes);
      assertEquals(cache.get("bytes-key"), bytes);
    });
  });

  describe("has", () => {
    it("should return true for existing key", () => {
      cache.set("key1", "value1");
      assertEquals(cache.has("key1"), true);
    });

    it("should return false for non-existent key", () => {
      assertEquals(cache.has("non-existent"), false);
    });
  });

  describe("delete", () => {
    it("should delete existing key", () => {
      cache.set("key1", "value1");
      assertEquals(cache.delete("key1"), true);
      assertEquals(cache.has("key1"), false);
    });

    it("should return false for non-existent key", () => {
      assertEquals(cache.delete("non-existent"), false);
    });
  });

  describe("deleteByPrefix", () => {
    it("should delete keys matching prefix", () => {
      cache.set("prefix:key1", "value1");
      cache.set("prefix:key2", "value2");
      cache.set("other:key3", "value3");

      const deleted = cache.deleteByPrefix("prefix:");

      assertEquals(deleted, 2);
      assertEquals(cache.has("prefix:key1"), false);
      assertEquals(cache.has("prefix:key2"), false);
      assertEquals(cache.has("other:key3"), true);
    });
  });

  describe("deleteByPrefixAndSuffix", () => {
    it("should delete keys matching prefix and suffix", () => {
      cache.set("prefix:data:suffix", "value1");
      cache.set("prefix:other:suffix", "value2");
      cache.set("prefix:data:other", "value3");

      const deleted = cache.deleteByPrefixAndSuffix("prefix:", "suffix");

      assertEquals(deleted, 2);
      assertEquals(cache.has("prefix:data:suffix"), false);
      assertEquals(cache.has("prefix:other:suffix"), false);
      assertEquals(cache.has("prefix:data:other"), true);
    });
  });

  describe("clear", () => {
    it("should clear all entries", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.clear();
      assertEquals(cache.has("key1"), false);
      assertEquals(cache.has("key2"), false);
    });
  });

  describe("stats", () => {
    it("should return cache stats", () => {
      cache.set("key1", "value1");
      cache.get("key1");
      cache.get("non-existent");

      const stats = cache.stats();

      assertEquals(stats.size, 1);
      assertEquals(stats.hits, 1);
      assertEquals(stats.misses, 1);
      assertEquals(stats.hitRate, 0.5);
      assertEquals(typeof stats.memoryUsed, "number");
      assertEquals(typeof stats.backend, "string");
    });
  });

  describe("disabled cache", () => {
    it("should not cache when disabled", () => {
      const disabledCache = new FileCache({ enabled: false });
      disabledCache.set("key1", "value1");
      assertEquals(disabledCache.get("key1"), undefined);
      assertEquals(disabledCache.has("key1"), false);
    });
  });
});

describe("Redis functions", () => {
  describe("initializeFileCacheRedis", () => {
    it("should export initializeFileCacheRedis function", () => {
      assertExists(initializeFileCacheRedis);
      assertEquals(typeof initializeFileCacheRedis, "function");
    });

    it("should return boolean", async () => {
      const result = await initializeFileCacheRedis();
      assertEquals(typeof result, "boolean");
    });
  });

  describe("isFileCacheRedisEnabled", () => {
    it("should export isFileCacheRedisEnabled function", () => {
      assertExists(isFileCacheRedisEnabled);
      assertEquals(typeof isFileCacheRedisEnabled, "function");
    });

    it("should return boolean", () => {
      const result = isFileCacheRedisEnabled();
      assertEquals(typeof result, "boolean");
    });
  });
});
