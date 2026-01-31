import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { CacheManager } from "./data-fetching-cache.ts";
import type { CacheEntry, DataContext } from "./types.ts";

function withProductionContext<T>(fn: () => T): T {
  return runWithCacheKeyContext(
    { projectId: "test-project", mode: "production", versionId: "rel_123" },
    fn,
  );
}

function createContext(
  url: string,
  params: Record<string, string | string[]> = {},
): DataContext {
  return {
    params,
    query: new URLSearchParams(),
    request: new Request(url),
    url: new URL(url),
  };
}

function createEntry<TProps extends Record<string, unknown>>(
  props: TProps,
  overrides: Partial<CacheEntry<TProps>> = {},
): CacheEntry<TProps> {
  return {
    data: { props },
    timestamp: Date.now(),
    ...overrides,
  };
}

function getEntryProps<T>(entry: CacheEntry): T {
  assertExists(entry.data.props);
  return entry.data.props as T;
}

describe("CacheManager", () => {
  describe("constructor", () => {
    it("should create a new instance", () => {
      assertExists(new CacheManager());
    });
  });

  describe("get/set", () => {
    it("should return null for non-existent key", () => {
      const cache = new CacheManager();
      assertEquals(cache.get("non-existent"), null);
    });

    it("should store and retrieve cache entry", () => {
      const cache = new CacheManager();
      const entry = createEntry({ title: "Test" }, { revalidate: 60 });

      cache.set("test-key", entry);
      const result = cache.get("test-key");

      assertExists(result);
      const props = getEntryProps<{ title: string }>(result);
      assertEquals(props.title, "Test");
      assertEquals(result.revalidate, 60);
    });

    it("should overwrite existing entry", () => {
      const cache = new CacheManager();
      const entry1 = createEntry({ value: 1 }, { revalidate: 60 });
      const entry2 = createEntry({ value: 2 }, { revalidate: 120 });

      cache.set("key", entry1);
      cache.set("key", entry2);

      const result = cache.get("key");
      assertExists(result);
      assertEquals(getEntryProps<{ value: number }>(result).value, 2);
      assertEquals(result.revalidate, 120);
    });
  });

  describe("delete", () => {
    it("should delete existing entry", () => {
      const cache = new CacheManager();
      cache.set("key", createEntry({}));

      assertExists(cache.get("key"));

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
      const entry = createEntry({});

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
      const entry = createEntry({});

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
      const entry = createEntry({});

      cache.set("/products/1", entry);
      cache.set("/products/2", entry);

      cache.clearPattern("/blog");

      assertExists(cache.get("/products/1"));
      assertExists(cache.get("/products/2"));
    });

    it("should handle partial matches", () => {
      const cache = new CacheManager();
      const entry = createEntry({});

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
      const entry = createEntry({}, { revalidate: false });

      assertEquals(cache.shouldRevalidate(entry), false);
    });

    it("should return false when entry is fresh", () => {
      const cache = new CacheManager();
      const entry = createEntry({}, { revalidate: 60 });

      assertEquals(cache.shouldRevalidate(entry), false);
    });

    it("should return true when entry is stale", () => {
      const cache = new CacheManager();
      const entry = createEntry(
        {},
        { timestamp: Date.now() - 120 * 1000, revalidate: 60 },
      );

      assertEquals(cache.shouldRevalidate(entry), true);
    });

    it("should return false when revalidate is undefined", () => {
      const cache = new CacheManager();
      const entry = createEntry({}, { timestamp: Date.now() - 120 * 1000 });

      assertEquals(cache.shouldRevalidate(entry), false);
    });

    it("should handle edge case at exact revalidation time", () => {
      const cache = new CacheManager();
      const revalidateSeconds = 60;
      const entry = createEntry(
        {},
        {
          timestamp: Date.now() - revalidateSeconds * 1000 - 1,
          revalidate: revalidateSeconds,
        },
      );

      assertEquals(cache.shouldRevalidate(entry), true);
    });
  });

  describe("createCacheKey", () => {
    it("should return null when no context is set", () => {
      const cache = new CacheManager();
      const key = cache.createCacheKey(
        createContext("http://localhost/posts/123", { id: "123" }),
      );

      assertEquals(key, null);
    });

    it("should return null in preview mode", () => {
      const cache = new CacheManager();
      const context = createContext("http://localhost/posts/123", { id: "123" });

      const key = runWithCacheKeyContext(
        { projectId: "test", mode: "preview", versionId: "main" },
        () => cache.createCacheKey(context),
      );

      assertEquals(key, null);
    });

    it("should create key from pathname and params in production mode", () => {
      const cache = new CacheManager();
      const context = createContext("http://localhost/posts/123", { id: "123" });

      const key = withProductionContext(() => cache.createCacheKey(context));

      assertExists(key);
      assertEquals(key.includes('/posts/123::{"id":"123"}'), true);
      assertEquals(key.includes("test-project"), true);
    });

    it("should create key with empty params in production mode", () => {
      const cache = new CacheManager();
      const context = createContext("http://localhost/about", {});

      const key = withProductionContext(() => cache.createCacheKey(context));

      assertExists(key);
      assertEquals(key.includes("/about::{}"), true);
    });

    it("should create unique keys for different params", () => {
      const cache = new CacheManager();
      const context1 = createContext("http://localhost/posts/1", { id: "1" });
      const context2 = createContext("http://localhost/posts/2", { id: "2" });

      const key1 = withProductionContext(() => cache.createCacheKey(context1));
      const key2 = withProductionContext(() => cache.createCacheKey(context2));

      assertExists(key1);
      assertExists(key2);
      assertEquals(key1 !== key2, true);
    });

    it("should handle array params (catch-all routes)", () => {
      const cache = new CacheManager();
      const context = createContext("http://localhost/docs/getting-started", {
        slug: ["docs", "getting-started"],
      });

      const key = withProductionContext(() => cache.createCacheKey(context));

      assertExists(key);
      assertEquals(key.includes("docs"), true);
      assertEquals(key.includes("getting-started"), true);
    });
  });
});
