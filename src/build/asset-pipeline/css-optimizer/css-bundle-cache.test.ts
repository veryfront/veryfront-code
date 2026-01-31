import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CacheManager } from "./css-bundle-cache.ts";

describe("build/asset-pipeline/css-optimizer/css-bundle-cache", () => {
  describe("CacheManager", () => {
    function createBundle(
      overrides: Partial<{
        file: string;
        content: string;
        size: number;
        minifiedSize: number;
        savings: number;
        sourceMap: string | undefined;
      }> = {},
    ) {
      return {
        file: overrides.file ?? "test.css",
        content: overrides.content ?? "body { color: red; }",
        size: overrides.size ?? 100,
        minifiedSize: overrides.minifiedSize ?? 80,
        savings: overrides.savings ?? 20,
        sourceMap: overrides.sourceMap,
      };
    }

    it("should start empty", () => {
      const cache = new CacheManager();
      assertEquals(cache.size(), 0);
    });

    it("should add and retrieve bundles", () => {
      const cache = new CacheManager();
      const bundle = createBundle({ file: "style.css" });

      cache.addBundle("style.css", bundle);

      assertEquals(cache.size(), 1);
      assertEquals(cache.getBundle("style.css"), bundle);
    });

    it("should return undefined for missing key", () => {
      const cache = new CacheManager();
      assertEquals(cache.getBundle("missing.css"), undefined);
    });

    it("should clear all bundles", () => {
      const cache = new CacheManager();

      cache.addBundle("a.css", createBundle({ file: "a.css" }));
      cache.addBundle("b.css", createBundle({ file: "b.css" }));

      assertEquals(cache.size(), 2);

      cache.clear();

      assertEquals(cache.size(), 0);
    });

    it("should return all bundles as a map", () => {
      const cache = new CacheManager();

      cache.addBundle("a.css", createBundle({ file: "a.css" }));
      cache.addBundle("b.css", createBundle({ file: "b.css" }));

      const all = cache.getAllBundles();

      assertEquals(all.size, 2);
      assertEquals(all.has("a.css"), true);
      assertEquals(all.has("b.css"), true);
    });

    describe("getStats", () => {
      it("should compute stats from bundles", () => {
        const cache = new CacheManager();

        cache.addBundle("a.css", createBundle({ size: 200, minifiedSize: 150 }));
        cache.addBundle("b.css", createBundle({ size: 300, minifiedSize: 200 }));

        const stats = cache.getStats();

        assertEquals(stats.totalFiles, 2);
        assertEquals(stats.originalSize, 500);
        assertEquals(stats.minifiedSize, 350);
        assertEquals(stats.totalSavings, 150);
        assertEquals(stats.averageSavings, 30); // 150/500*100 = 30%
      });

      it("should return zero stats for empty cache", () => {
        const cache = new CacheManager();
        const stats = cache.getStats();

        assertEquals(stats.totalFiles, 0);
        assertEquals(stats.originalSize, 0);
        assertEquals(stats.minifiedSize, 0);
        assertEquals(stats.totalSavings, 0);
        assertEquals(stats.averageSavings, 0);
      });

      it("should cache stats and invalidate on add", () => {
        const cache = new CacheManager();

        cache.addBundle("a.css", createBundle({ size: 100, minifiedSize: 80 }));

        const stats1 = cache.getStats();
        const stats2 = cache.getStats();

        assertEquals(stats1.totalFiles, 1);
        assertEquals(stats1, stats2);

        cache.addBundle("b.css", createBundle({ size: 200, minifiedSize: 100 }));

        const stats3 = cache.getStats();
        assertEquals(stats3.totalFiles, 2);
      });

      it("should invalidate stats cache on clear", () => {
        const cache = new CacheManager();

        cache.addBundle("a.css", createBundle({ size: 100, minifiedSize: 80 }));
        cache.getStats(); // populate cache

        cache.clear();

        const stats = cache.getStats();
        assertEquals(stats.totalFiles, 0);
      });
    });

    describe("getTotalSavings", () => {
      it("should format savings string correctly", () => {
        const cache = new CacheManager();

        cache.addBundle("a.css", createBundle({ size: 1024, minifiedSize: 512 }));

        const result = cache.getTotalSavings();

        assertEquals(result.includes("1.0KB"), true);
        assertEquals(result.includes("0.5KB"), true);
        assertEquals(result.includes("50.0%"), true);
      });

      it("should handle zero original size", () => {
        const cache = new CacheManager();

        cache.addBundle("a.css", createBundle({ size: 0, minifiedSize: 0 }));

        const result = cache.getTotalSavings();
        assertEquals(result.includes("0.0%"), true);
      });
    });
  });
});
