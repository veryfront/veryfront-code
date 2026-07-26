import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
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
      assertEquals(
        key,
        'veryfront:page-css:v1:["proj-123","production","/home","2024-01-01"]',
      );
    });

    it("fails closed when project identity is missing", () => {
      assertThrows(
        () =>
          getPageCssCacheKey(
            undefined as unknown as string,
            undefined,
            "/page",
            undefined,
          ),
        Error,
        "project identity",
      );
    });

    it("preserves absent optional identity instead of inventing shared defaults", () => {
      const key = getPageCssCacheKey("proj", undefined, "/about", "v1");
      assertEquals(key, 'veryfront:page-css:v1:["proj",null,"/about","v1"]');
    });

    it("does not alias delimiter-bearing route and version components", () => {
      const left = getPageCssCacheKey("proj", "preview", "/a:b", "c");
      const right = getPageCssCacheKey("proj", "preview", "/a", "b:c");

      assertNotEquals(left, right);
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
});
