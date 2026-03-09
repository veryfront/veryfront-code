import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectCachesForTests,
  destroyTransformCache,
  generateCacheKey,
  getCachedTransform,
  getCachedTransformAsync,
  getOrComputeTransform,
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

    it("produces different keys for studioEmbed vs non-studioEmbed", () => {
      const key1 = generateCacheKey("app/page.tsx", "abc", false, true);
      const key2 = generateCacheKey("app/page.tsx", "abc", false, false);
      assertEquals(key1 !== key2, true);
    });

    it("includes depsHash when provided", () => {
      const key1 = generateCacheKey("app/page.tsx", "abc", false, false, { depsHash: "deps1" });
      const key2 = generateCacheKey("app/page.tsx", "abc", false, false, { depsHash: "deps2" });
      assertEquals(key1 !== key2, true);
    });

    it("includes configHash when provided", () => {
      const key1 = generateCacheKey("app/page.tsx", "abc", false, false, { configHash: "cfg1" });
      const key2 = generateCacheKey("app/page.tsx", "abc", false, false, { configHash: "cfg2" });
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

    it("overwrites existing entry", () => {
      setCachedTransform("test-key", "const x = 1;", "hash1");
      setCachedTransform("test-key", "const x = 2;", "hash2");
      const result = getCachedTransform("test-key");
      assertEquals(result?.code, "const x = 2;");
      assertEquals(result?.hash, "hash2");
    });

    it("stores timestamp", () => {
      setCachedTransform("test-key", "const x = 1;", "hash1");
      const result = getCachedTransform("test-key");
      assertEquals(typeof result?.timestamp, "number");
      assertEquals(result!.timestamp > 0, true);
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

    it("stores bundleManifestId when provided", async () => {
      await setCachedTransformAsync("manifest-key", "const x = 1;", "hash1", 300, "manifest-abc");
      const result = await getCachedTransformAsync("manifest-key");
      assertEquals(result?.bundleManifestId, "manifest-abc");
    });
  });

  describe("getOrComputeTransform", () => {
    beforeEach(() => {
      const testMap = new Map<string, { code: string; hash: string; timestamp: number }>();
      __injectCachesForTests({ localFallback: testMap, cacheBackend: null });
    });

    afterEach(() => {
      __injectCachesForTests(null);
    });

    it("computes on cache miss", async () => {
      let computed = false;
      const result = await getOrComputeTransform("miss-key", async () => {
        computed = true;
        return "computed-code";
      });
      assertEquals(computed, true);
      assertEquals(result.code, "computed-code");
      assertEquals(result.cacheHit, false);
    });

    it("returns cached value on hit", async () => {
      // First call populates cache
      await getOrComputeTransform("hit-key", async () => "first-value");

      // Second call should be a cache hit
      let computed = false;
      const result = await getOrComputeTransform("hit-key", async () => {
        computed = true;
        return "second-value";
      });
      assertEquals(computed, false);
      assertEquals(result.code, "first-value");
      assertEquals(result.cacheHit, true);
    });

    it("invalidates cache with unresolved _vf_modules imports", async () => {
      // Manually set a cache entry with unresolved _vf_modules
      await setCachedTransformAsync(
        "stale-key",
        'import { foo } from "_vf_modules/_veryfront/lib.js";',
        "hash1",
      );

      let computed = false;
      const result = await getOrComputeTransform("stale-key", async () => {
        computed = true;
        return "fresh-code";
      });
      assertEquals(computed, true);
      assertEquals(result.code, "fresh-code");
      assertEquals(result.cacheHit, false);
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
