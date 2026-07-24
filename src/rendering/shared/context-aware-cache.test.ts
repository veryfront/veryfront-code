import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ContextAwareCacheCoordinator } from "./context-aware-cache.ts";
import type { CachePayload, CacheStore } from "../cache/types.ts";
import { parseSerializedCachePayload, serializeCachePayload } from "../cache/cache-payload.ts";
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

async function withStoreTtlEnabled(fn: () => Promise<void>): Promise<void> {
  const globalState = globalThis as Record<string, unknown>;
  const previousGlobal = globalState.__vfDisableLruInterval;
  const previousEnv = Deno.env.get("VF_DISABLE_LRU_INTERVAL");

  globalState.__vfDisableLruInterval = false;
  Deno.env.delete("VF_DISABLE_LRU_INTERVAL");

  try {
    await fn();
  } finally {
    if (previousGlobal === undefined) {
      delete globalState.__vfDisableLruInterval;
    } else {
      globalState.__vfDisableLruInterval = previousGlobal;
    }

    if (previousEnv === undefined) {
      Deno.env.delete("VF_DISABLE_LRU_INTERVAL");
    } else {
      Deno.env.set("VF_DISABLE_LRU_INTERVAL", previousEnv);
    }
  }
}

describe("rendering/shared/context-aware-cache", () => {
  describe("ContextAwareCacheCoordinator", () => {
    it("rejects invalid TTL/stale durations", () => {
      for (const ttlMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertThrows(() => new ContextAwareCacheCoordinator({ ttlMs }), RangeError, "ttlMs");
      }
      for (const staleMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertThrows(() => new ContextAwareCacheCoordinator({ staleMs }), RangeError, "staleMs");
      }
    });

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

    it("evicts malformed store values and reports a miss", async () => {
      let deletedKey: string | undefined;
      const store: CacheStore = {
        get: () => Promise.resolve({} as CachePayload),
        set: () => Promise.resolve(),
        delete: (key) => {
          deletedKey = key;
          return Promise.resolve();
        },
        clear: () => Promise.resolve(),
        destroy: () => Promise.resolve(),
      };
      const cache = new ContextAwareCacheCoordinator({ store });

      const lookup = await cache.checkCache("malformed", makeMockCtx());

      assertEquals(lookup.hit, false);
      assertEquals(lookup.status, "miss");
      assertEquals(deletedKey, lookup.cacheKey);
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

    it("preserves Date frontmatter through the production coordinator wire path", async () => {
      let serialized: string | undefined;
      const store: CacheStore = {
        get: () =>
          Promise.resolve(
            serialized === undefined ? undefined : parseSerializedCachePayload(serialized),
          ),
        set: (_key, value) => {
          serialized = serializeCachePayload(value);
          return Promise.resolve();
        },
        delete: () => {
          serialized = undefined;
          return Promise.resolve();
        },
        clear: () => {
          serialized = undefined;
          return Promise.resolve();
        },
        destroy: () => Promise.resolve(),
      };
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();
      const publishedAt = new Date("2026-07-24T08:30:00.000Z");

      await cache.persistResult(
        {
          html: "<h1>Dated</h1>",
          frontmatter: { publishedAt },
          headings: [],
          stream: null,
        },
        "dated",
        ctx,
      );
      const lookup = await cache.checkCache("dated", ctx);

      assertEquals(lookup.status, "hit");
      assertEquals(
        lookup.cachedResult?.frontmatter.publishedAt,
        new Date("2026-07-24T08:30:00.000Z"),
      );
      assertEquals(lookup.cachedResult?.frontmatter.publishedAt === publishedAt, false);
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
      const cache = new ContextAwareCacheCoordinator({ store, ttlMs: 1, staleMs: 0 });
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

    it("should serve stale cached results inside the stale window", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store, ttlMs: 1, staleMs: 1_000 });
      const ctx = makeMockCtx();

      const renderResult = {
        html: "<h1>Stale</h1>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "stale",
      };

      await cache.persistResult(renderResult as any, "stale-page", ctx);
      await new Promise((r) => setTimeout(r, 10));

      const lookup = await cache.checkCache("stale-page", ctx);
      assertEquals(lookup.hit, true);
      assertEquals(lookup.status, "stale");
      assertEquals(lookup.cachedResult?.html, "<h1>Stale</h1>");
      assertEquals(typeof lookup.lookupDurationMs, "number");
    });

    it("should expire preview entries instead of serving stale without a refresh path", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store, ttlMs: 1, staleMs: 1_000 });
      const ctx = makeMockCtx({
        mode: "development",
        environment: "preview",
        cachePrefix: "proj-1:preview:branch-main",
        contentSourceId: "branch-main",
      });

      const renderResult = {
        html: "<h1>Preview stale</h1>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "preview-stale",
      };

      await cache.persistResult(renderResult as any, "preview-page", ctx);
      await new Promise((r) => setTimeout(r, 10));

      const lookup = await cache.checkCache("preview-page", ctx);
      assertEquals(lookup.hit, false);
      assertEquals(lookup.status, "expired");
      assertEquals(lookup.cachedResult, undefined);
    });

    it("should report expired when the memory store TTL path is enabled", async () => {
      await withStoreTtlEnabled(async () => {
        const cache = new ContextAwareCacheCoordinator({ ttlMs: 1, staleMs: 0 });
        const ctx = makeMockCtx();

        const renderResult = {
          html: "<h1>Expired</h1>",
          frontmatter: {},
          headings: [],
          stream: null,
          ssrHash: "exp",
        };

        await cache.persistResult(renderResult as any, "store-ttl-page", ctx);
        await new Promise((r) => setTimeout(r, 10));

        const lookup = await cache.checkCache("store-ttl-page", ctx);
        assertEquals(lookup.hit, false);
        assertEquals(lookup.status, "expired");

        await cache.destroy();
      });
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

    it("clears a slug without deleting sibling slug prefixes", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();
      const result = (html: string) => ({
        html,
        frontmatter: {},
        headings: [],
        stream: null,
      });
      await cache.persistResult(result("a"), "a", ctx);
      await cache.persistResult(result("about"), "about", ctx);

      await cache.clearSlug("a", ctx);

      assertEquals((await cache.checkCache("a", ctx)).hit, false);
      assertEquals((await cache.checkCache("about", ctx)).cachedResult?.html, "about");
    });

    it("encodes project IDs for project-scoped invalidation", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const projectId = "project:west/one";
      const ctx = makeMockCtx({
        projectId,
        cachePrefix: `${encodeURIComponent(projectId)}:production:release-1`,
      });
      await cache.persistResult({ html: "value", frontmatter: {}, stream: null }, "page", ctx);

      await cache.clearForProject(projectId);

      assertEquals((await cache.checkCache("page", ctx)).hit, false);
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

    it("rejects unsupported scoped invalidation instead of reporting success", async () => {
      const store: CacheStore = {
        get: () => Promise.resolve(undefined),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        clear: () => Promise.resolve(),
        destroy: () => Promise.resolve(),
      };
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      await assertRejects(
        () => cache.clearForContext(ctx),
        TypeError,
        "context-scoped invalidation",
      );
      await assertRejects(
        () => cache.clearForProject(ctx.projectId),
        TypeError,
        "project-scoped invalidation",
      );
      await assertRejects(
        () => cache.clearForProject(""),
        TypeError,
        "non-empty projectId",
      );
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

      const nestedFrontmatter = { seo: { title: "Original" } };
      const node = { attrs: { className: "original" } };
      const original = {
        html: "<h1>Original</h1>",
        frontmatter: nestedFrontmatter,
        headings: [{ id: "original", level: 1, text: "Original" }],
        nodeMap: new Map([[1, node]]),
        stream: null,
        ssrHash: "orig",
      };

      await cache.persistResult(original as any, "clone-test", ctx);
      nestedFrontmatter.seo.title = "Mutated input";
      node.attrs.className = "mutated-input";

      const lookup = await cache.checkCache("clone-test", ctx);
      assertEquals(lookup.hit, true);
      assertEquals(
        (lookup.cachedResult?.frontmatter as unknown as { seo: { title: string } }).seo.title,
        "Original",
      );
      assertEquals(
        (lookup.cachedResult?.nodeMap?.get(1) as { attrs: { className: string } }).attrs
          .className,
        "original",
      );

      if (lookup.cachedResult) {
        lookup.cachedResult.html = "MUTATED";
        (lookup.cachedResult.frontmatter as unknown as { seo: { title: string } }).seo.title =
          "Mutated output";
        if (lookup.cachedResult.headings?.[0]) {
          lookup.cachedResult.headings[0].text = "Mutated output";
        }
        (lookup.cachedResult.nodeMap?.get(1) as { attrs: { className: string } }).attrs.className =
          "mutated-output";
      }

      const reLookup = await cache.checkCache("clone-test", ctx);
      assertEquals(reLookup.cachedResult?.html, "<h1>Original</h1>");
      assertEquals(
        (reLookup.cachedResult?.frontmatter as unknown as { seo: { title: string } }).seo.title,
        "Original",
      );
      assertEquals(reLookup.cachedResult?.headings?.[0]?.text, "Original");
      assertEquals(
        (reLookup.cachedResult?.nodeMap?.get(1) as { attrs: { className: string } }).attrs
          .className,
        "original",
      );
    });
  });
});
