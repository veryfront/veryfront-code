import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectCssCacheForTests,
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

      __injectCssCacheForTests(mockRepo);

      // getCachedPageCss returns undefined when repo is injected (sync fallback)
      const key = `injected-test-${Date.now()}`;
      cachePageCss(key, "injected-css");

      // Sync getter returns undefined when repo is injected
      assertEquals(getCachedPageCss(key), undefined);

      // But the mock repo should have it
      await new Promise((r) => setTimeout(r, 10)); // Wait for fire-and-forget
      assertEquals(injectedCache.get(key), "injected-css");

      // Restore
      __injectCssCacheForTests(null);
    });
  });
});
