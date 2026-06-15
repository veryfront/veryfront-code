import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ContextAwareCacheCoordinator } from "./context-aware-cache.ts";
import type { CachePayload, CacheStore } from "../cache/types.ts";
import type { RenderContext } from "../context/render-context.ts";

function createInMemoryStore(): CacheStore & { data: Map<string, CachePayload> } {
  const data = new Map<string, CachePayload>();

  return {
    data,
    get(key: string) {
      return Promise.resolve(data.get(key));
    },
    set(key: string, value: CachePayload) {
      data.set(key, value);
      return Promise.resolve();
    },
    delete(key: string) {
      data.delete(key);
      return Promise.resolve();
    },
    deleteByPrefix(prefix: string) {
      let deleted = 0;

      for (const key of data.keys()) {
        if (!key.startsWith(prefix)) continue;
        data.delete(key);
        deleted++;
      }

      return Promise.resolve(deleted);
    },
    clear() {
      data.clear();
      return Promise.resolve();
    },
    destroy() {
      data.clear();
      return Promise.resolve();
    },
  };
}

function makeMockCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    projectId: "proj-1",
    projectSlug: "my-project",
    projectDir: "/project",
    config: {} as RenderContext["config"],
    mode: "production",
    adapter: {} as RenderContext["adapter"],
    cachePrefix: "proj-1:production:release-1",
    environment: "production",
    contentSourceId: "release-1",
    ...overrides,
  };
}

describe("rendering/shared/context-aware-cache", () => {
  describe("ContextAwareCacheCoordinator", () => {
    it("should create with default options", () => {
      const cache = new ContextAwareCacheCoordinator();
      assertEquals(cache instanceof ContextAwareCacheCoordinator, true);
    });

    it("should create with custom store", () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      assertEquals(cache instanceof ContextAwareCacheCoordinator, true);
    });

    it("should report cache miss for uncached keys", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      const result = await cache.checkCache("index", ctx);
      assertEquals(result.hit, false);
      assertEquals(result.status, "miss");
      assertEquals(typeof result.lookupDurationMs, "number");
      assertEquals(result.cachedResult, undefined);
      assertEquals(typeof result.cacheKey, "string");
    });

    it("should persist and retrieve cached results", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      const renderResult = {
        html: "<h1>Hello</h1>",
        frontmatter: { title: "Test" },
        headings: [],
        stream: null,
        ssrHash: "abc123",
      };

      await cache.persistResult(renderResult as any, "index", ctx);

      const lookup = await cache.checkCache("index", ctx);
      assertEquals(lookup.hit, true);
      assertEquals(lookup.status, "hit");
      assertEquals(typeof lookup.lookupDurationMs, "number");
      assertEquals(lookup.cachedResult?.html, "<h1>Hello</h1>");
      assertEquals(lookup.cachedResult?.ssrHash, "abc123");
    });

    it("should not cache results with streams", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      const streamResult = {
        html: "<h1>Stream</h1>",
        frontmatter: {},
        headings: [],
        stream: {} as ReadableStream,
        ssrHash: "def",
      };

      await cache.persistResult(streamResult as any, "stream-page", ctx);

      const lookup = await cache.checkCache("stream-page", ctx);
      assertEquals(lookup.hit, false);
    });

    it("should not cache null results", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      await cache.persistResult(null as any, "null-page", ctx);

      const lookup = await cache.checkCache("null-page", ctx);
      assertEquals(lookup.hit, false);
    });

    it("should handle TTL-based expiration", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store, ttlMs: 1 });
      const ctx = makeMockCtx();

      const renderResult = {
        html: "<h1>Expired</h1>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "exp",
      };

      await cache.persistResult(renderResult as any, "ttl-page", ctx);

      await new Promise((r) => setTimeout(r, 10));

      const lookup = await cache.checkCache("ttl-page", ctx);
      assertEquals(lookup.hit, false);
      assertEquals(lookup.status, "expired");
      assertEquals(typeof lookup.lookupDurationMs, "number");
    });

    it("should use color scheme in cache key", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      const renderResult = {
        html: "<h1>Light</h1>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "light",
      };

      await cache.persistResult(renderResult as any, "themed", ctx, "light");

      const lightLookup = await cache.checkCache("themed", ctx, "light");
      assertEquals(lightLookup.hit, true);

      const darkLookup = await cache.checkCache("themed", ctx, "dark");
      assertEquals(darkLookup.hit, false);

      const noThemeLookup = await cache.checkCache("themed", ctx);
      assertEquals(noThemeLookup.hit, false);
    });

    it("should clear all cached data", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      const result = {
        html: "<h1>Cached</h1>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "x",
      };

      await cache.persistResult(result as any, "page1", ctx);
      await cache.clearAll();

      const lookup = await cache.checkCache("page1", ctx);
      assertEquals(lookup.hit, false);
    });

    it("should clear cache for specific project", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      const result = {
        html: "<h1>Project</h1>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "p",
      };

      await cache.persistResult(result as any, "pg", ctx);
      await cache.clearForProject("proj-1");

      const lookup = await cache.checkCache("pg", ctx);
      assertEquals(lookup.hit, false);
    });

    it("should return stats", () => {
      const cache = new ContextAwareCacheCoordinator();
      const stats = cache.getStats();
      assertEquals(typeof stats.size, "number");
      assertEquals(stats.size, 0);
    });

    it("should destroy the store", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      await cache.destroy();
      assertEquals(store.data.size, 0);
    });

    it("should clear slug using deleteByPrefix when available", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      const result = {
        html: "<h1>Slug</h1>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "s",
      };

      await cache.persistResult(result as any, "my-page", ctx);
      const beforeClear = await cache.checkCache("my-page", ctx);
      assertEquals(beforeClear.hit, true);

      await cache.clearSlug("my-page", ctx);
      const afterClear = await cache.checkCache("my-page", ctx);
      assertEquals(afterClear.hit, false);
    });

    it("should clear slug without deleteByPrefix (fallback to individual deletes)", async () => {
      // Create a store WITHOUT deleteByPrefix
      const data = new Map<string, CachePayload>();
      const deletedKeys: string[] = [];
      const storeWithoutPrefix: CacheStore = {
        get: (key: string) => Promise.resolve(data.get(key)),
        set: (key: string, value: CachePayload) => {
          data.set(key, value);
          return Promise.resolve();
        },
        delete: (key: string) => {
          deletedKeys.push(key);
          data.delete(key);
          return Promise.resolve();
        },
        clear: () => {
          data.clear();
          return Promise.resolve();
        },
        destroy: () => Promise.resolve(),
      };

      const cache = new ContextAwareCacheCoordinator({ store: storeWithoutPrefix });
      const ctx = makeMockCtx();

      await cache.clearSlug("test-slug", ctx);
      // Should have attempted to delete keys containing the target slug
      assertEquals(deletedKeys.length >= 1, true);
      assertEquals(deletedKeys.every((k) => k.includes("test-slug")), true);
    });

    it("should clear for context using prefix deletion", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      const result = {
        html: "<h1>Ctx</h1>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "c",
      };

      await cache.persistResult(result as any, "ctx-page", ctx);
      await cache.clearForContext(ctx);

      const lookup = await cache.checkCache("ctx-page", ctx);
      assertEquals(lookup.hit, false);
    });

    it("should return stats with populated store that has size method", async () => {
      const baseStore = createInMemoryStore();
      const store = {
        ...baseStore,
        size() {
          return baseStore.data.size;
        },
      };
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      const result = {
        html: "<h1>Stats</h1>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "st",
      };

      await cache.persistResult(result as any, "stats-page", ctx);
      const stats = cache.getStats();
      assertEquals(stats.size >= 1, true);
    });

    it("should read stats from the cache store stats contract", () => {
      const store = {
        ...createInMemoryStore(),
        getStats() {
          return { size: 7 };
        },
      };
      const cache = new ContextAwareCacheCoordinator({ store });

      assertEquals(cache.getStats(), { size: 7 });
    });

    it("should return size 0 when store has no stats contract", () => {
      const cache = new ContextAwareCacheCoordinator();
      const stats = cache.getStats();
      assertEquals(stats.size, 0);
    });

    it("should clone cached results to prevent mutation", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      const original = {
        html: "<h1>Original</h1>",
        frontmatter: { title: "Original" },
        headings: [{ level: 1, text: "Original" }],
        stream: null,
        ssrHash: "orig",
      };

      await cache.persistResult(original as any, "clone-test", ctx);

      const lookup = await cache.checkCache("clone-test", ctx);
      assertEquals(lookup.hit, true);

      if (lookup.cachedResult) {
        lookup.cachedResult.html = "MUTATED";
      }

      const reLookup = await cache.checkCache("clone-test", ctx);
      assertEquals(reLookup.cachedResult?.html, "<h1>Original</h1>");
    });
  });
});
