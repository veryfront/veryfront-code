import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotStrictEquals } from "#veryfront/testing/assert.ts";
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

    it("rebinds cached inline nonce slots without touching application tags", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();
      const renderResult = {
        html: '<script nonce="nonce-a">framework()</script>' +
          '<style nonce="nonce-a">.framework{}</style>' +
          '<script nonce="application-owned">application()</script>',
        frontmatter: {},
        headings: [],
        stream: null,
      };

      await cache.persistResult(
        renderResult as any,
        "nonce-page",
        ctx,
        undefined,
        undefined,
        "nonce-a",
      );
      const lookup = await cache.checkCache(
        "nonce-page",
        ctx,
        undefined,
        undefined,
        "nonce-b",
      );

      assertEquals(lookup.cachedResult?.html.includes('nonce="nonce-b">framework()'), true);
      assertEquals(lookup.cachedResult?.html.includes('nonce="nonce-b">.framework{}'), true);
      assertEquals(
        lookup.cachedResult?.html.includes('nonce="application-owned">application()'),
        true,
      );
      assertEquals(lookup.cachedResult?.html.includes("nonce-a"), false);
      assertEquals(lookup.cachedResult?.html.includes("veryfront-cache-nonce"), false);
    });

    it("rejects and evicts an unsealed entry when the response enforces a nonce", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();
      const renderResult = {
        html: "<script>framework()</script>",
        frontmatter: {},
        headings: [],
        stream: null,
      };

      // Persisted without a nonce, so the entry carries no sealed placeholder.
      await cache.persistResult(renderResult as any, "legacy-nonce-page", ctx);

      const lookup = await cache.checkCache(
        "legacy-nonce-page",
        ctx,
        undefined,
        undefined,
        "nonce-x",
      );

      assertEquals(
        lookup.status,
        "miss",
        "an entry stored without a nonce placeholder must not be served to a nonce-enforcing response",
      );
      assertEquals(lookup.hit, false, "an unsealed entry must not count as a hit");
      assertEquals(lookup.cachedResult, undefined, "an unsealed entry must not return HTML");
      assertEquals(
        store.data.has(lookup.cacheKey),
        false,
        "the incompatible entry must be evicted, not left to poison later lookups",
      );
    });

    it("serves a sealed entry without a nonce by stripping the cached slots", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();
      const renderResult = {
        html: '<script nonce="nonce-a">framework()</script>',
        frontmatter: {},
        headings: [],
        stream: null,
      };

      await cache.persistResult(
        renderResult as any,
        "sealed-nonce-page",
        ctx,
        undefined,
        undefined,
        "nonce-a",
      );

      const lookup = await cache.checkCache("sealed-nonce-page", ctx);

      assertEquals(
        lookup.hit,
        true,
        "a sealed entry stays usable for a response that enforces no nonce",
      );
      assertEquals(
        lookup.cachedResult?.html.includes("nonce="),
        false,
        "a response without a nonce must not receive a nonce attribute",
      );
      assertEquals(
        lookup.cachedResult?.html.includes("vf-cache-"),
        false,
        "the cache placeholder must never reach the response",
      );
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

    it("honours cacheKeyOverride when keying entries", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      const renderResult = {
        html: "<h1>Variant A</h1>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "variant-a",
      };

      await cache.persistResult(
        renderResult as any,
        "index",
        ctx,
        undefined,
        "page:index:variant-a",
      );

      const sameOverride = await cache.checkCache("index", ctx, undefined, "page:index:variant-a");
      assertEquals(sameOverride.hit, true, "the same override must hit");

      const otherOverride = await cache.checkCache("index", ctx, undefined, "page:index:variant-b");
      assertEquals(otherOverride.hit, false, "a different override must miss");

      const noOverride = await cache.checkCache("index", ctx);
      assertEquals(
        noOverride.hit,
        false,
        "an override entry must not be served to callers passing no override",
      );
    });

    it("does not double-suffix an override that already carries a theme", async () => {
      const store = createInMemoryStore();
      const cache = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();

      const renderResult = {
        html: "<h1>Themed override</h1>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "themed-override",
      };

      await cache.persistResult(
        renderResult as any,
        "index",
        ctx,
        "light",
        "page:index:theme-light",
      );

      const lookup = await cache.checkCache("index", ctx, "light", "page:index:theme-light");
      assertEquals(lookup.hit, true, "the themed override must hit its own entry");
      assertEquals(
        lookup.cacheKey.match(/:theme-light/g)?.length,
        1,
        "an override already carrying a theme suffix must not be double-suffixed",
      );
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

    for (const operation of ["clearSlug", "clearForContext"] as const) {
      it(`invalidates derived route keys across coordinators using ${operation}`, async () => {
        const store = createInMemoryStore();
        Reflect.deleteProperty(store, "deleteByPrefix");
        const writer = new ContextAwareCacheCoordinator({ store });
        const clearer = new ContextAwareCacheCoordinator({ store: { ...store } });
        const ctx = makeMockCtx();
        const lookup = () =>
          writer.checkCache("/data", ctx, undefined, "/data?q=1", undefined, "route");
        await writer.persistResult(
          { html: "old query", frontmatter: {}, stream: null },
          "/data",
          ctx,
          undefined,
          "/data?q=1",
          undefined,
          "route",
        );
        assertEquals((await lookup()).hit, true);
        if (operation === "clearSlug") await clearer.clearSlug("/data", ctx);
        else await clearer.clearForContext(ctx);
        assertEquals((await lookup()).hit, false);
      });
    }

    it("distinguishes derived route keys from explicit scoped aliases", async () => {
      const cache = new ContextAwareCacheCoordinator({ store: createInMemoryStore() });
      const ctx = makeMockCtx();
      await cache.persistResult(
        { html: "route result", frontmatter: {}, stream: null },
        "route",
        ctx,
        undefined,
        "route",
        undefined,
        "route",
      );
      assertEquals((await cache.checkCache("route", ctx)).cachedResult?.html, "route result");
      await cache.persistResult(
        { html: "shared result", frontmatter: {}, stream: null },
        "first",
        ctx,
        undefined,
        "render-identity:hash-shared",
        undefined,
        "alias",
      );
      assertEquals(
        (await cache.checkCache(
          "second",
          ctx,
          undefined,
          "render-identity:hash-shared",
          undefined,
          "alias",
        )).cachedResult?.html,
        "shared result",
      );
      assertEquals(
        (await cache.checkCache("second", ctx, undefined, "render-identity:hash-shared")).hit,
        false,
      );
    });

    for (
      const key of ["shared:react-runtime:custom", "pins:custom", "render-identity:hash-custom"]
    ) {
      it(`supports explicit scoped-looking alias ${key} without prefix deletion`, async () => {
        const store = createInMemoryStore();
        Reflect.deleteProperty(store, "deleteByPrefix");
        const writer = new ContextAwareCacheCoordinator({ store });
        const reader = new ContextAwareCacheCoordinator({ store: { ...store } });
        const ctx = makeMockCtx();
        const lookup = () => reader.checkCache("second", ctx, undefined, key, undefined, "alias");
        await writer.persistResult(
          { html: "shared", frontmatter: {}, stream: null },
          "first",
          ctx,
          undefined,
          key,
          undefined,
          "alias",
        );
        assertEquals((await lookup()).cachedResult?.html, "shared");
        await reader.clearForContext(ctx);
        assertEquals((await lookup()).hit, false);
      });
    }

    it("invalidates aliases in every project context across independent coordinators", async () => {
      const store = createInMemoryStore();
      Reflect.deleteProperty(store, "deleteByPrefix");
      const writer = new ContextAwareCacheCoordinator({ store });
      const clearer = new ContextAwareCacheCoordinator({ store: { ...store } });
      const ctx = makeMockCtx();
      const otherContext = makeMockCtx({ cachePrefix: "proj-1:preview:branch-other" });
      const otherProject = makeMockCtx({
        projectId: "proj-2",
        cachePrefix: "proj-2:production:release-1",
      });
      const result = { html: "old", frontmatter: {}, stream: null };
      const lookup = (context: RenderContext, key = "shared") =>
        writer.checkCache("page", context, undefined, key);
      for (const context of [ctx, otherContext, otherProject]) {
        await writer.persistResult(result, "page", context, undefined, "shared");
        assertEquals((await lookup(context)).hit, true);
      }
      await clearer.clearForProject(ctx.projectId);
      assertEquals((await lookup(ctx)).hit, false);
      assertEquals((await lookup(otherContext)).hit, false);
      assertEquals((await lookup(otherProject)).hit, true);
      await writer.persistResult(result, "page", ctx, undefined, "fresh");
      assertEquals((await lookup(ctx, "fresh")).hit, true);
      assertEquals(
        (await lookup(otherContext)).hit,
        false,
        "new writes must not resurrect an old context generation",
      );
      await clearer.clearForContext(ctx);
      assertEquals((await lookup(otherProject)).hit, true);
    });

    for (const prefixCapable of [false, true]) {
      it(`preserves explicit override sharing with prefix support ${prefixCapable}`, async () => {
        const store = createInMemoryStore();
        if (!prefixCapable) Reflect.deleteProperty(store, "deleteByPrefix");
        const writer = new ContextAwareCacheCoordinator({ store });
        const reader = new ContextAwareCacheCoordinator({ store: { ...store } });
        const ctx = makeMockCtx();
        await writer.persistResult(
          { html: "shared result", frontmatter: {}, stream: null },
          "first",
          ctx,
          undefined,
          "shared",
        );
        const otherContext = makeMockCtx({
          projectId: "proj-2",
          cachePrefix: "proj-2:production:release-1",
        });
        await writer.persistResult(
          { html: "other context", frontmatter: {}, stream: null },
          "other",
          otherContext,
          undefined,
          "shared",
        );
        assertEquals(
          (await reader.checkCache("shared", ctx)).hit,
          false,
          "aliases cannot populate normal route keys",
        );
        const lookup = await reader.checkCache("second", ctx, undefined, "shared");
        assertEquals(lookup.hit, true);
        assertEquals(lookup.cachedResult?.html, "shared result");
        await writer.persistResult(
          { html: "updated shared", frontmatter: {}, stream: null },
          "second",
          ctx,
          undefined,
          "shared",
        );
        assertEquals(
          (await reader.checkCache("first", ctx, undefined, "shared")).cachedResult?.html,
          "updated shared",
        );
        await writer.persistResult(
          { html: "old sibling", frontmatter: {}, stream: null },
          "third",
          ctx,
          undefined,
          "sibling-alias",
        );
        await reader.clearSlug("first", ctx);
        assertEquals((await writer.checkCache("second", ctx, undefined, "shared")).hit, false);
        assertEquals(
          (await reader.checkCache("other", otherContext, undefined, "shared")).hit,
          true,
        );
        await writer.persistResult(
          { html: "new generation", frontmatter: {}, stream: null },
          "second",
          ctx,
          undefined,
          "shared",
        );
        assertEquals((await reader.checkCache("second", ctx, undefined, "shared")).hit, true);
        assertEquals(
          (await reader.checkCache("third", ctx, undefined, "sibling-alias")).hit,
          false,
        );
        await reader.clearForContext(ctx);
        assertEquals((await writer.checkCache("second", ctx, undefined, "shared")).hit, false);
      });
    }

    for (const prefixCapable of [false, true]) {
      it(`retains concurrent aliases across store handles with prefix support ${prefixCapable}`, async () => {
        const store = createInMemoryStore();
        if (!prefixCapable) Reflect.deleteProperty(store, "deleteByPrefix");
        const first = new ContextAwareCacheCoordinator({ store });
        const second = new ContextAwareCacheCoordinator({ store: { ...store } });
        const ctx = makeMockCtx();
        await Promise.all([
          first.persistResult(
            { html: "one", frontmatter: {}, stream: null },
            "one",
            ctx,
            undefined,
            "alias-one",
          ),
          second.persistResult(
            { html: "two", frontmatter: {}, stream: null },
            "two",
            ctx,
            undefined,
            "alias-two",
          ),
        ]);
        assertEquals(
          (await second.checkCache("one", ctx, undefined, "alias-one")).cachedResult?.html,
          "one",
        );
        assertEquals(
          (await first.checkCache("two", ctx, undefined, "alias-two")).cachedResult?.html,
          "two",
        );
      });
    }

    it("invalidates scoped and hashed variants across coordinators sharing a prefix-capable store", async () => {
      const store = createInMemoryStore();
      const writer = new ContextAwareCacheCoordinator({ store });
      const clearer = new ContextAwareCacheCoordinator({ store });
      const ctx = makeMockCtx();
      const other = makeMockCtx({
        projectId: "proj-2",
        cachePrefix: "proj-2:production:release-1",
      });
      const result = { html: "scoped", frontmatter: {}, stream: null };
      const variants = [
        "test-slug:react-runtime:first",
        "render-identity:hash-scoped",
        "custom-key",
      ];
      for (const key of variants) {
        await writer.persistResult(result, "test-slug", ctx, undefined, key);
      }
      await writer.persistResult(result, "other-slug", ctx, undefined, variants[0]);
      await writer.persistResult(result, "test-slug", other, undefined, variants[0]);
      await clearer.clearSlug("test-slug", ctx);
      for (const key of variants) {
        assertEquals((await writer.checkCache("test-slug", ctx, undefined, key)).hit, false);
      }
      assertEquals((await writer.checkCache("other-slug", ctx, undefined, variants[0])).hit, true);
      assertEquals((await writer.checkCache("test-slug", other, undefined, variants[0])).hit, true);
      await clearer.clearForContext(ctx);
      assertEquals((await writer.checkCache("other-slug", ctx, undefined, variants[0])).hit, false);
      await clearer.clearForProject("proj-2");
      assertEquals(
        (await writer.checkCache("test-slug", other, undefined, variants[0])).hit,
        false,
      );
      await writer.destroy();
    });

    it("does not admit scoped caching when a shared store cannot invalidate prefixes", async () => {
      const store = createInMemoryStore();
      const { deleteByPrefix: _unused, ...withoutPrefix } = store;
      const cache = new ContextAwareCacheCoordinator({ store: withoutPrefix });
      const ctx = makeMockCtx();
      const key = "page:test:react-runtime:captured";
      await cache.persistResult(
        { html: "unsafe", frontmatter: {}, stream: null },
        "test",
        ctx,
        undefined,
        key,
      );
      assertEquals(store.data.size, 0);
      assertEquals((await cache.checkCache("test", ctx, undefined, key)).hit, false);
      await cache.persistResult({ html: "legacy", frontmatter: {}, stream: null }, "legacy", ctx);
      assertEquals((await cache.checkCache("legacy", ctx)).hit, true);
      await cache.destroy();
    });

    it("clears locally written legacy entries on stores without prefix deletion", async () => {
      const store = createInMemoryStore();
      const { deleteByPrefix: _unused, ...withoutPrefix } = store;
      const cache = new ContextAwareCacheCoordinator({
        store: withoutPrefix,
        memory: { maxEntries: 2 },
      });
      const ctx = makeMockCtx();
      const other = makeMockCtx({
        projectId: "proj-2",
        cachePrefix: "proj-2:production:release-1",
      });
      const result = { html: "legacy", frontmatter: {}, stream: null };
      await cache.persistResult(result, "old", ctx);
      await cache.persistResult(result, "new", ctx);
      await cache.persistResult(result, "other", other);
      assertEquals(
        (await cache.checkCache("old", ctx)).hit,
        false,
        "bounded fallback evicts older entries",
      );
      assertEquals((await cache.checkCache("new", ctx)).hit, true);
      await cache.clearForContext(ctx);
      assertEquals((await cache.checkCache("new", ctx)).hit, false);
      assertEquals((await cache.checkCache("other", other)).hit, true);
      await cache.clearForProject("proj-2");
      assertEquals((await cache.checkCache("other", other)).hit, false);
      await cache.destroy();
    });

    it("continues caching new routes through backing-store LRU eviction", async () => {
      const cache = new ContextAwareCacheCoordinator({ memory: { maxEntries: 2 } });
      const ctx = makeMockCtx();
      const result = { html: "cached", frontmatter: {}, stream: null };
      for (const slug of ["one", "two", "three"]) await cache.persistResult(result, slug, ctx);
      assertEquals((await cache.checkCache("three", ctx)).hit, true);
      assertEquals((await cache.checkCache("one", ctx)).hit, false);
      await cache.destroy();
    });

    for (const clear of ["clearAll", "destroy"] as const) {
      it(`drains admitted writes before ${clear}`, async () => {
        const store = createInMemoryStore();
        const cache = new ContextAwareCacheCoordinator({ store });
        const write = cache.persistResult(
          { html: "pending", frontmatter: {}, stream: null },
          "pending",
          makeMockCtx(),
        );
        await Promise.all([write, cache[clear]()]);
        assertEquals(store.data.size, 0, "a prior write cannot repopulate a cleared store");
      });
    }

    for (const clear of ["clearSlug", "clearForContext", "clearForProject"] as const) {
      it(`invalidates old HTML when a replacement write rejects during ${clear}`, async () => {
        const store = createInMemoryStore();
        const cache = new ContextAwareCacheCoordinator({ store });
        const ctx = makeMockCtx();
        const key = "pending:react-runtime:captured";
        await cache.persistResult(
          { html: "old", frontmatter: {}, stream: null },
          "pending",
          ctx,
          undefined,
          key,
        );
        let release!: () => void;
        let admitted!: () => void;
        const started = new Promise<void>((resolve) => {
          admitted = resolve;
        });
        const blocked = new Promise<void>((resolve) => {
          release = resolve;
        });
        store.set = async () => {
          admitted();
          await blocked;
          throw new Error("write rejected");
        };
        const write = cache.persistResult(
          { html: "new", frontmatter: {}, stream: null },
          "pending",
          ctx,
          undefined,
          key,
        );
        await started;
        const invalidate = clear === "clearSlug"
          ? cache.clearSlug("pending", ctx)
          : clear === "clearForContext"
          ? cache.clearForContext(ctx)
          : cache.clearForProject(ctx.projectId);
        release();
        const outcomes = await Promise.allSettled([write, invalidate]);
        assertEquals(outcomes.map((result) => result.status), ["rejected", "rejected"]);
        assertEquals((await cache.checkCache("pending", ctx, undefined, key)).hit, false);
        await cache.destroy();
      });
    }

    for (const secondSlug of ["first", "independent"]) {
      it(`keeps a failed predecessor from aborting write and clear for ${secondSlug}`, async () => {
        const store = createInMemoryStore();
        let rejectFirst!: (error: Error) => void;
        let admit!: () => void;
        const admitted = new Promise<void>((resolve) => {
          admit = resolve;
        });
        let writes = 0;
        const set = store.set;
        store.set = async (key, payload) => {
          if (++writes === 1) {
            admit();
            await new Promise<void>((_resolve, reject) => {
              rejectFirst = reject;
            });
          }
          await set(key, payload);
        };
        const cache = new ContextAwareCacheCoordinator({ store, memory: { maxEntries: 1 } });
        const ctx = makeMockCtx();
        const result = { html: "recovered", frontmatter: {}, stream: null };
        const first = cache.persistResult(result, "first", ctx);
        const second = cache.persistResult(result, secondSlug, ctx);
        const settled = Promise.allSettled([first, second]);
        await admitted;
        const cleared = Promise.allSettled([cache.clearForContext(ctx)]);
        rejectFirst(new Error("transient write failure"));
        const outcomes = await settled;
        assertEquals(
          outcomes.map((outcome) => outcome.status),
          ["rejected", "fulfilled"],
          "each write owns its failure",
        );
        const clearOutcome = (await cleared)[0];
        if (clearOutcome.status === "rejected") {
          assertEquals(clearOutcome.reason instanceof AggregateError, true);
        }
        assertEquals(writes, 2, "later operation reaches the recovered store");
        assertEquals(store.data.size, 0, "failed predecessor must not prevent invalidation");
        await cache.destroy();
      });
    }

    it("orders a reused key behind its pending eviction", async () => {
      const store = createInMemoryStore();
      let release!: () => void;
      let admit!: () => void;
      const admitted = new Promise<void>((resolve) => {
        admit = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const set = store.set;
      store.set = async (key, payload) => {
        if (payload.result.html === "old-a") {
          admit();
          await blocked;
        }
        await set(key, payload);
      };
      const cache = new ContextAwareCacheCoordinator({ store, memory: { maxEntries: 2 } });
      const ctx = makeMockCtx();
      const result = (html: string) => ({ html, frontmatter: {}, stream: null });
      const first = cache.persistResult(result("old-a"), "a", ctx);
      await admitted;
      await cache.persistResult(result("c"), "c", ctx);
      const evict = cache.persistResult(result("b"), "b", ctx);
      const replace = cache.persistResult(result("new-a"), "a", ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      release();
      await Promise.all([first, evict, replace]);
      assertEquals(
        (await cache.checkCache("a", ctx)).cachedResult?.html,
        "new-a",
        "eviction cannot delete the later successful write",
      );
      await cache.destroy();
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
        nodeMap: new Map<number, unknown>([[1, {}]]),
        stream: null,
        ssrHash: "orig",
      };

      await cache.persistResult(original as any, "clone-test", ctx);

      const lookup = await cache.checkCache("clone-test", ctx);
      assertEquals(lookup.hit, true);

      if (lookup.cachedResult) {
        lookup.cachedResult.html = "MUTATED";
        lookup.cachedResult.headings!.push({ id: "injected", level: 2, text: "Injected" });
        (lookup.cachedResult.frontmatter as Record<string, unknown>).title = "MUTATED";
      }

      const reLookup = await cache.checkCache("clone-test", ctx);
      assertEquals(reLookup.cachedResult?.html, "<h1>Original</h1>");
      assertEquals(
        reLookup.cachedResult?.headings?.length,
        1,
        "a cached headings array must not be shared with a previous caller",
      );
      assertEquals(
        reLookup.cachedResult?.frontmatter.title,
        "Original",
        "a cached frontmatter object must not be shared with a previous caller",
      );
      assertNotStrictEquals(
        lookup.cachedResult?.nodeMap,
        reLookup.cachedResult?.nodeMap,
        "each lookup must receive its own nodeMap instance",
      );
    });
  });
});
