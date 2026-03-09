import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectCachesForTests,
  destroyTransformCache,
  generateCacheKey,
  getCachedTransform,
  getCachedTransformAsync,
  setCachedTransform,
  setCachedTransformAsync,
} from "./transform-cache.ts";

describe("transforms/esm/transform-cache", () => {
  describe("generateCacheKey", () => {
    it("generates a string key", () => {
      const key = generateCacheKey("app/page.tsx", "abc123");
      assertEquals(typeof key, "string");
      assertEquals(key.length > 0, true);
    });

    it("includes file path info", () => {
      const key = generateCacheKey("app/page.tsx", "abc123");
      assertEquals(key.includes("app/page.tsx"), true);
    });

    it("produces different keys for different content hashes", () => {
      const key1 = generateCacheKey("app/page.tsx", "abc");
      const key2 = generateCacheKey("app/page.tsx", "def");
      assertEquals(key1 !== key2, true);
    });

    it("produces different keys for SSR vs browser", () => {
      const key1 = generateCacheKey("app/page.tsx", "abc", true);
      const key2 = generateCacheKey("app/page.tsx", "abc", false);
      assertEquals(key1 !== key2, true);
    });
  });

  describe("getCachedTransform / setCachedTransform", () => {
    beforeEach(() => {
      const testMap = new Map<string, { code: string; hash: string; timestamp: number }>();
      __injectCachesForTests({ localFallback: testMap, cacheBackend: null });
    });

    afterEach(() => {
      __injectCachesForTests(null);
    });

    it("returns undefined for missing key", () => {
      assertEquals(getCachedTransform("nonexistent"), undefined);
    });

    it("stores and retrieves a transform", () => {
      setCachedTransform("test-key", "const x = 1;", "hash1");
      const result = getCachedTransform("test-key");
      assertEquals(result?.code, "const x = 1;");
      assertEquals(result?.hash, "hash1");
    });
  });

  describe("getCachedTransformAsync / setCachedTransformAsync", () => {
    beforeEach(() => {
      const testMap = new Map<string, { code: string; hash: string; timestamp: number }>();
      __injectCachesForTests({ localFallback: testMap, cacheBackend: null });
    });

    afterEach(() => {
      __injectCachesForTests(null);
    });

    it("returns undefined for missing key", async () => {
      const result = await getCachedTransformAsync("nonexistent-async");
      assertEquals(result, undefined);
    });

    it("stores and retrieves a transform async", async () => {
      await setCachedTransformAsync("async-key", "const y = 2;", "hash2");
      const result = await getCachedTransformAsync("async-key");
      assertEquals(result?.code, "const y = 2;");
    });
  });

  describe("destroyTransformCache", () => {
    beforeEach(() => {
      const testMap = new Map<string, { code: string; hash: string; timestamp: number }>();
      __injectCachesForTests({ localFallback: testMap, cacheBackend: null });
    });

    afterEach(() => {
      __injectCachesForTests(null);
    });

    it("clears all entries", () => {
      setCachedTransform("k1", "code1", "h1");
      setCachedTransform("k2", "code2", "h2");
      destroyTransformCache();
      assertEquals(getCachedTransform("k1"), undefined);
      assertEquals(getCachedTransform("k2"), undefined);
    });
  });
});
