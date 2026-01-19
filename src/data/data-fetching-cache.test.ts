import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CacheManager } from "./data-fetching-cache.ts";
import type { CacheEntry, DataContext } from "./types.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";

// Helper to run tests with production mode cache context
function withProductionContext<T>(fn: () => T): T {
  return runWithCacheKeyContext(
    { projectId: "test-project", mode: "production", versionId: "rel_123" },
    fn,
  );
}

describe("CacheManager", () => {
  describe("constructor", () => {
    it("should create a new instance", () => {
      const cache = new CacheManager();
      assertExists(cache);
    });
  });

  describe("get/set", () => {
    it("should return null for non-existent key", () => {
      const cache = new CacheManager();
      const result = cache.get("non-existent");
      assertEquals(result, null);
    });

    it("should store and retrieve cache entry", () => {
      const cache = new CacheManager();
      const entry: CacheEntry<{ title: string }> = {
        data: { props: { title: "Test" } },
        timestamp: Date.now(),
        revalidate: 60,
      };

      cache.set("test-key", entry);
      const result = cache.get("test-key");

      assertExists(result);
      assertEquals((result.data.props as { title: string })?.title, "Test");
      assertEquals(result.revalidate, 60);
    });

    it("should overwrite existing entry", () => {
      const cache = new CacheManager();
      const entry1: CacheEntry<{ value: number }> = {
        data: { props: { value: 1 } },
        timestamp: Date.now(),
        revalidate: 60,
      };
      const entry2: CacheEntry<{ value: number }> = {
        data: { props: { value: 2 } },
        timestamp: Date.now(),
        revalidate: 120,
      };

      cache.set("key", entry1);
      cache.set("key", entry2);
      const result = cache.get("key");

      assertEquals((result?.data.props as { value: number })?.value, 2);
      assertEquals(result?.revalidate, 120);
    });
  });

  describe("delete", () => {
    it("should delete existing entry", () => {
      const cache = new CacheManager();
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
      };

      cache.set("key", entry);
      assertEquals(cache.get("key") !== null, true);

      cache.delete("key");
      assertEquals(cache.get("key"), null);
    });

    it("should not throw when deleting non-existent key", () => {
      const cache = new CacheManager();
      cache.delete("non-existent");
      assertEquals(cache.get("non-existent"), null);
    });
  });

  describe("clear", () => {
    it("should remove all entries", () => {
      const cache = new CacheManager();
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
      };

      cache.set("key1", entry);
      cache.set("key2", entry);
      cache.set("key3", entry);

      cache.clear();

      assertEquals(cache.get("key1"), null);
      assertEquals(cache.get("key2"), null);
      assertEquals(cache.get("key3"), null);
    });
  });

  describe("clearPattern", () => {
    it("should clear entries matching pattern", () => {
      const cache = new CacheManager();
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
      };

      cache.set("/blog/post-1", entry);
      cache.set("/blog/post-2", entry);
      cache.set("/about", entry);
      cache.set("/contact", entry);

      cache.clearPattern("/blog");

      assertEquals(cache.get("/blog/post-1"), null);
      assertEquals(cache.get("/blog/post-2"), null);
      assertExists(cache.get("/about"));
      assertExists(cache.get("/contact"));
    });

    it("should not affect non-matching entries", () => {
      const cache = new CacheManager();
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
      };

      cache.set("/products/1", entry);
      cache.set("/products/2", entry);

      cache.clearPattern("/blog");

      assertExists(cache.get("/products/1"));
      assertExists(cache.get("/products/2"));
    });

    it("should handle partial matches", () => {
      const cache = new CacheManager();
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
      };

      cache.set("/api/users", entry);
      cache.set("/api/posts", entry);
      cache.set("/dashboard", entry);

      cache.clearPattern("/api");

      assertEquals(cache.get("/api/users"), null);
      assertEquals(cache.get("/api/posts"), null);
      assertExists(cache.get("/dashboard"));
    });
  });

  describe("shouldRevalidate", () => {
    it("should return false when revalidate is false", () => {
      const cache = new CacheManager();
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
        revalidate: false,
      };

      assertEquals(cache.shouldRevalidate(entry), false);
    });

    it("should return false when entry is fresh", () => {
      const cache = new CacheManager();
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
        revalidate: 60, // 60 seconds
      };

      assertEquals(cache.shouldRevalidate(entry), false);
    });

    it("should return true when entry is stale", () => {
      const cache = new CacheManager();
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now() - 120 * 1000, // 2 minutes ago
        revalidate: 60, // revalidate after 60 seconds
      };

      assertEquals(cache.shouldRevalidate(entry), true);
    });

    it("should return false when revalidate is undefined", () => {
      const cache = new CacheManager();
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now() - 120 * 1000,
        // no revalidate set
      };

      assertEquals(cache.shouldRevalidate(entry), false);
    });

    it("should handle edge case at exact revalidation time", () => {
      const cache = new CacheManager();
      const revalidateSeconds = 60;
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now() - revalidateSeconds * 1000 - 1, // just past revalidation
        revalidate: revalidateSeconds,
      };

      assertEquals(cache.shouldRevalidate(entry), true);
    });
  });

  describe("createCacheKey", () => {
    it("should return null when no context is set", () => {
      const cache = new CacheManager();
      const context: DataContext = {
        params: { id: "123" },
        query: new URLSearchParams(),
        request: new Request("http://localhost/posts/123"),
        url: new URL("http://localhost/posts/123"),
      };

      const key = cache.createCacheKey(context);

      assertEquals(key, null);
    });

    it("should return null in preview mode", () => {
      const cache = new CacheManager();
      const context: DataContext = {
        params: { id: "123" },
        query: new URLSearchParams(),
        request: new Request("http://localhost/posts/123"),
        url: new URL("http://localhost/posts/123"),
      };

      const key = runWithCacheKeyContext(
        { projectId: "test", mode: "preview", versionId: "main" },
        () => cache.createCacheKey(context),
      );

      assertEquals(key, null);
    });

    it("should create key from pathname and params in production mode", () => {
      const cache = new CacheManager();
      const context: DataContext = {
        params: { id: "123" },
        query: new URLSearchParams(),
        request: new Request("http://localhost/posts/123"),
        url: new URL("http://localhost/posts/123"),
      };

      const key = withProductionContext(() => cache.createCacheKey(context));

      assertExists(key);
      assertEquals(key.includes('/posts/123::{"id":"123"}'), true);
      assertEquals(key.includes("test-project"), true);
    });

    it("should create key with empty params in production mode", () => {
      const cache = new CacheManager();
      const context: DataContext = {
        params: {},
        query: new URLSearchParams(),
        request: new Request("http://localhost/about"),
        url: new URL("http://localhost/about"),
      };

      const key = withProductionContext(() => cache.createCacheKey(context));

      assertExists(key);
      assertEquals(key.includes("/about::{}"), true);
    });

    it("should create unique keys for different params", () => {
      const cache = new CacheManager();
      const context1: DataContext = {
        params: { id: "1" },
        query: new URLSearchParams(),
        request: new Request("http://localhost/posts/1"),
        url: new URL("http://localhost/posts/1"),
      };
      const context2: DataContext = {
        params: { id: "2" },
        query: new URLSearchParams(),
        request: new Request("http://localhost/posts/2"),
        url: new URL("http://localhost/posts/2"),
      };

      const key1 = withProductionContext(() => cache.createCacheKey(context1));
      const key2 = withProductionContext(() => cache.createCacheKey(context2));

      assertExists(key1);
      assertExists(key2);
      assertEquals(key1 !== key2, true);
    });

    it("should handle array params (catch-all routes)", () => {
      const cache = new CacheManager();
      const context: DataContext = {
        params: { slug: ["docs", "getting-started"] },
        query: new URLSearchParams(),
        request: new Request("http://localhost/docs/getting-started"),
        url: new URL("http://localhost/docs/getting-started"),
      };

      const key = withProductionContext(() => cache.createCacheKey(context));

      assertExists(key);
      assertEquals(key.includes("docs"), true);
      assertEquals(key.includes("getting-started"), true);
    });
  });
});
