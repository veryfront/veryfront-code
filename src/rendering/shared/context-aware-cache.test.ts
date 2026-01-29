import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ContextAwareCacheCoordinator } from "./context-aware-cache.ts";
import type { CacheStore } from "../cache/types.ts";
import type { RenderContext } from "../context/render-context.ts";

/** In-memory cache store for testing */
function createInMemoryStore(): CacheStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: (key: string) => Promise.resolve(data.get(key) as any),
    set: (key: string, value: unknown) => {
      data.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      data.delete(key);
      return Promise.resolve();
    },
    deleteByPrefix: (prefix: string) => {
      let deleted = 0;
      for (const key of data.keys()) {
        if (key.startsWith(prefix)) {
          data.delete(key);
          deleted++;
        }
      }
      return Promise.resolve(deleted);
    },
    clear: () => {
      data.clear();
      return Promise.resolve();
    },
    destroy: () => {
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
        stream: {} as ReadableStream, // non-null stream
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

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 10));

      const lookup = await cache.checkCache("ttl-page", ctx);
      assertEquals(lookup.hit, false);
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

      // Light theme should hit
      const lightLookup = await cache.checkCache("themed", ctx, "light");
      assertEquals(lightLookup.hit, true);

      // Dark theme should miss
      const darkLookup = await cache.checkCache("themed", ctx, "dark");
      assertEquals(darkLookup.hit, false);

      // No theme should miss
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

      // Mutate the returned result
      if (lookup.cachedResult) {
        lookup.cachedResult.html = "MUTATED";
      }

      // Re-fetch should return original
      const reLookup = await cache.checkCache("clone-test", ctx);
      assertEquals(reLookup.cachedResult?.html, "<h1>Original</h1>");
    });
  });
});
