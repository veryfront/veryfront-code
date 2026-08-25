import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import {
  __injectCssCacheForTests,
  __pageCssCacheForTests,
  cachePageCss,
  CSS_SSR_TIMEOUT_MS,
  getCachedPageCss,
  getPageCssCacheKey,
  PAGE_CSS_CACHE_MAX_SIZE,
} from "./css-cache.ts";

describe("css-cache", () => {
  describe("constants", () => {
    it("has reasonable timeout", () => {
      assertEquals(CSS_SSR_TIMEOUT_MS, 5000);
    });

    it("has reasonable max cache size", () => {
      assertEquals(PAGE_CSS_CACHE_MAX_SIZE, 200);
    });
  });

  describe("getPageCssCacheKey", () => {
    it("creates key with all parts", () => {
      const key = getPageCssCacheKey("proj-123", "production", "/home", "2024-01-01");
      assertEquals(key, "proj-123:production:/home:2024-01-01");
    });

    it("uses defaults for undefined values", () => {
      const key = getPageCssCacheKey(undefined, undefined, "/page", undefined);
      assertEquals(key, "default:preview:/page:draft");
    });

    it("handles mixed defined/undefined values", () => {
      const key = getPageCssCacheKey("proj", undefined, "/about", "v1");
      assertEquals(key, "proj:preview:/about:v1");
    });

    it("isolates dependency snapshots and module origins", () => {
      const snapshotA = getPageCssCacheKey(
        "proj",
        "production",
        "/about",
        "v1",
        "on:34n9smy47dk9",
        "https://a.example.test",
      );
      const snapshotB = getPageCssCacheKey(
        "proj",
        "production",
        "/about",
        "v1",
        "on:34n8mjmdp7io",
        "https://a.example.test",
      );
      const otherOrigin = getPageCssCacheKey(
        "proj",
        "production",
        "/about",
        "v1",
        "on:34n9smy47dk9",
        "https://b.example.test",
      );

      assertNotEquals(snapshotA, snapshotB);
      assertNotEquals(snapshotA, otherOrigin);

      cachePageCss(snapshotA, "/* snapshot A */");
      cachePageCss(snapshotB, "/* snapshot B */");
      assertEquals(getCachedPageCss(snapshotA), "/* snapshot A */");
      assertEquals(getCachedPageCss(snapshotB), "/* snapshot B */");
    });
  });

  describe("cachePageCss and getCachedPageCss", () => {
    it("stores and retrieves CSS", () => {
      const key = `test-css-${Date.now()}`;
      const css = "body { color: red; }";

      cachePageCss(key, css);
      assertEquals(getCachedPageCss(key), css);
    });

    it("returns undefined for unknown keys", () => {
      assertEquals(getCachedPageCss("nonexistent-key"), undefined);
    });

    it("overwrites existing CSS for same key", () => {
      const key = `test-overwrite-${Date.now()}`;
      cachePageCss(key, "old");
      cachePageCss(key, "new");
      assertEquals(getCachedPageCss(key), "new");
    });

    it("evicts least-recently-used entry under cache pressure", () => {
      __pageCssCacheForTests.clear();

      // Fill cache to capacity: fill-0 is oldest, fill-199 is newest
      for (let i = 0; i < PAGE_CSS_CACHE_MAX_SIZE; i++) {
        cachePageCss(`lru-fill-${i}`, `css-${i}`);
      }
      assertEquals(__pageCssCacheForTests.size, PAGE_CSS_CACHE_MAX_SIZE);

      // Touch the oldest entry (fill-0) to promote it to most-recently-used
      getCachedPageCss("lru-fill-0");

      // Insert one more entry — the LRU entry is now fill-1 (second-oldest, not touched)
      cachePageCss("lru-overflow", "overflow-css");
      assertEquals(__pageCssCacheForTests.size, PAGE_CSS_CACHE_MAX_SIZE);

      // fill-0 was recently accessed and must survive
      assertEquals(getCachedPageCss("lru-fill-0"), "css-0");

      // fill-1 was least-recently-used and must have been evicted
      assertEquals(getCachedPageCss("lru-fill-1"), undefined);

      // The new entry must be present
      assertEquals(getCachedPageCss("lru-overflow"), "overflow-css");

      __pageCssCacheForTests.clear();
    });
  });

  describe("__injectCssCacheForTests", () => {
    it("bypasses internal cache when injected", async () => {
      const injectedCache = new Map<string, string>();
      const mockRepo = {
        get: async (key: string) => injectedCache.get(key) ?? null,
        set: async (key: string, value: string) => {
          injectedCache.set(key, value);
        },
        delete: async (_key: string) => {},
        clear: async () => {},
        context: { projectId: "test", environment: "preview" as const, versionId: "v1" },
      };

      // Seed the process-local LRU first so the sync getter has something stale
      // to serve if it ever ignores the injected repository.
      const key = `injected-test-${Date.now()}`;
      cachePageCss(key, "stale-internal-css");
      assertEquals(
        getCachedPageCss(key),
        "stale-internal-css",
        "the process-local LRU holds the entry before a repo is injected",
      );

      __injectCssCacheForTests(mockRepo);

      try {
        cachePageCss(key, "injected-css");

        // Sync getter must force a miss while a repo is injected
        assertEquals(
          getCachedPageCss(key),
          undefined,
          "the sync getter must force a miss while a repo is injected, not serve the process-local LRU",
        );

        // But the mock repo should have it
        await waitFor(() => injectedCache.get(key) === "injected-css", {
          message: "fire-and-forget write reaches the injected repo",
        });
        assertEquals(injectedCache.get(key), "injected-css");
      } finally {
        // Restore
        __injectCssCacheForTests(null);
        __pageCssCacheForTests.delete(key);
      }
    });
  });
});
