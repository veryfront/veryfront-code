import { assertEquals, assert } from "std/assert/mod.ts";
import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { CacheManager } from "./data-fetching-cache.ts";
import type { CacheEntry, DataContext } from "./types.ts";

describe("CacheManager", () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    // Disable LRU interval for tests
    (globalThis as Record<string, unknown>).__vfDisableLruInterval = true;
    cacheManager = new CacheManager();
  });

  describe("get and set", () => {
    it("should set and get cache entries", () => {
      const entry: CacheEntry = {
        data: { props: { foo: "bar" } },
        timestamp: Date.now(),
        revalidate: false,
      };

      cacheManager.set("test-key", entry);
      const result = cacheManager.get("test-key");

      assertEquals(result, entry);
    });

    it("should return null for non-existent keys", () => {
      const result = cacheManager.get("non-existent");

      assertEquals(result, null);
    });

    it("should overwrite existing entries", () => {
      const entry1: CacheEntry = {
        data: { props: { value: 1 } },
        timestamp: Date.now(),
      };

      const entry2: CacheEntry = {
        data: { props: { value: 2 } },
        timestamp: Date.now(),
      };

      cacheManager.set("key", entry1);
      cacheManager.set("key", entry2);

      const result = cacheManager.get("key");
      assertEquals(result, entry2);
    });
  });

  describe("delete", () => {
    it("should delete cache entries", () => {
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
      };

      cacheManager.set("test-key", entry);
      cacheManager.delete("test-key");

      const result = cacheManager.get("test-key");
      assertEquals(result, null);
    });

    it("should handle deleting non-existent keys", () => {
      cacheManager.delete("non-existent");
      const result = cacheManager.get("non-existent");
      assertEquals(result, null);
    });
  });

  describe("clear", () => {
    it("should clear all cache entries", () => {
      const entry1: CacheEntry = {
        data: { props: { a: 1 } },
        timestamp: Date.now(),
      };

      const entry2: CacheEntry = {
        data: { props: { b: 2 } },
        timestamp: Date.now(),
      };

      cacheManager.set("key1", entry1);
      cacheManager.set("key2", entry2);

      cacheManager.clear();

      assertEquals(cacheManager.get("key1"), null);
      assertEquals(cacheManager.get("key2"), null);
    });

    it("should work on empty cache", () => {
      cacheManager.clear();
      assertEquals(cacheManager.get("any-key"), null);
    });
  });

  describe("clearPattern", () => {
    it("should clear entries matching pattern", () => {
      const entry1: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
      };

      const entry2: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
      };

      const entry3: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
      };

      cacheManager.set("/blog/post-1", entry1);
      cacheManager.set("/blog/post-2", entry2);
      cacheManager.set("/about", entry3);

      cacheManager.clearPattern("/blog");

      assertEquals(cacheManager.get("/blog/post-1"), null);
      assertEquals(cacheManager.get("/blog/post-2"), null);
      assertEquals(cacheManager.get("/about"), entry3);
    });

    it("should handle pattern with no matches", () => {
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
      };

      cacheManager.set("key", entry);
      cacheManager.clearPattern("non-matching");

      assertEquals(cacheManager.get("key"), entry);
    });

    it("should support partial string matching", () => {
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
      };

      cacheManager.set("user-123-profile", entry);
      cacheManager.clearPattern("123");

      assertEquals(cacheManager.get("user-123-profile"), null);
    });
  });

  describe("shouldRevalidate", () => {
    it("should return false when revalidate is false", () => {
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
        revalidate: false,
      };

      const result = cacheManager.shouldRevalidate(entry);
      assertEquals(result, false);
    });

    it("should return false when revalidate is undefined", () => {
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
      };

      const result = cacheManager.shouldRevalidate(entry);
      assertEquals(result, false);
    });

    it("should return false when entry is not yet stale", () => {
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
        revalidate: 3600, // 1 hour
      };

      const result = cacheManager.shouldRevalidate(entry);
      assertEquals(result, false);
    });

    it("should return true when entry is stale", () => {
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now() - 3700 * 1000, // More than 1 hour ago
        revalidate: 3600, // 1 hour
      };

      const result = cacheManager.shouldRevalidate(entry);
      assertEquals(result, true);
    });

    it("should handle edge case at exact revalidation time", () => {
      const now = Date.now();
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: now - 60 * 1000, // Exactly 60 seconds ago
        revalidate: 60, // 60 seconds
      };

      const result = cacheManager.shouldRevalidate(entry);
      // Should not revalidate at exactly the threshold
      assertEquals(result, false);
    });

    it("should handle short revalidation times", () => {
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now() - 2000, // 2 seconds ago
        revalidate: 1, // 1 second
      };

      const result = cacheManager.shouldRevalidate(entry);
      assertEquals(result, true);
    });
  });

  describe("createCacheKey", () => {
    it("should create cache key from context", () => {
      const context: DataContext = {
        params: { id: "123" },
        query: new URLSearchParams("foo=bar"),
        request: new Request("https://example.com/page"),
        url: new URL("https://example.com/page"),
      };

      const key = cacheManager.createCacheKey(context);

      assert(key.includes("/page"));
      assert(key.includes('"id":"123"'));
    });

    it("should create consistent keys for same context", () => {
      const context: DataContext = {
        params: { slug: "hello" },
        query: new URLSearchParams(),
        request: new Request("https://example.com/blog/hello"),
        url: new URL("https://example.com/blog/hello"),
      };

      const key1 = cacheManager.createCacheKey(context);
      const key2 = cacheManager.createCacheKey(context);

      assertEquals(key1, key2);
    });

    it("should create different keys for different params", () => {
      const context1: DataContext = {
        params: { id: "1" },
        query: new URLSearchParams(),
        request: new Request("https://example.com/page"),
        url: new URL("https://example.com/page"),
      };

      const context2: DataContext = {
        params: { id: "2" },
        query: new URLSearchParams(),
        request: new Request("https://example.com/page"),
        url: new URL("https://example.com/page"),
      };

      const key1 = cacheManager.createCacheKey(context1);
      const key2 = cacheManager.createCacheKey(context2);

      assert(key1 !== key2);
    });

    it("should create different keys for different paths", () => {
      const context1: DataContext = {
        params: {},
        query: new URLSearchParams(),
        request: new Request("https://example.com/page1"),
        url: new URL("https://example.com/page1"),
      };

      const context2: DataContext = {
        params: {},
        query: new URLSearchParams(),
        request: new Request("https://example.com/page2"),
        url: new URL("https://example.com/page2"),
      };

      const key1 = cacheManager.createCacheKey(context1);
      const key2 = cacheManager.createCacheKey(context2);

      assert(key1 !== key2);
    });

    it("should handle array params", () => {
      const context: DataContext = {
        params: { slug: ["blog", "post", "123"] },
        query: new URLSearchParams(),
        request: new Request("https://example.com/blog/post/123"),
        url: new URL("https://example.com/blog/post/123"),
      };

      const key = cacheManager.createCacheKey(context);

      assert(key.includes("blog"));
      assert(key.includes("post"));
      assert(key.includes("123"));
    });

    it("should handle empty params", () => {
      const context: DataContext = {
        params: {},
        query: new URLSearchParams(),
        request: new Request("https://example.com/"),
        url: new URL("https://example.com/"),
      };

      const key = cacheManager.createCacheKey(context);

      assert(key.length > 0);
      assertEquals(key, "/::{}");
    });
  });
});
