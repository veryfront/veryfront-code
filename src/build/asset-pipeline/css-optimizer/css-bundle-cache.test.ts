import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CacheManager } from "./css-bundle-cache.ts";
import type { CSSBundle } from "./types/index.ts";
import { calculateSavings } from "./utils.ts";

function bundle(
  file: string,
  originalSize: number,
  content: string,
): CSSBundle {
  const minifiedSize = new TextEncoder().encode(content).length;
  return {
    file,
    content,
    size: originalSize,
    minifiedSize,
    savings: calculateSavings(originalSize, minifiedSize),
  };
}

describe("build/asset-pipeline/css-optimizer/css-bundle-cache", () => {
  it("starts empty and clears all state", () => {
    const cache = new CacheManager();
    assertEquals(cache.size(), 0);
    cache.addBundle("a.css", bundle("a.css", 10, "12345"));
    assertEquals(cache.size(), 1);
    cache.clear();
    assertEquals(cache.size(), 0);
    assertEquals(cache.getStats().totalFiles, 0);
  });

  it("computes aggregate byte savings", () => {
    const cache = new CacheManager();
    cache.addBundle("a.css", bundle("a.css", 100, "a".repeat(50)));
    cache.addBundle("b.css", bundle("b.css", 100, "b".repeat(75)));

    assertEquals(cache.getStats(), {
      totalFiles: 2,
      originalSize: 200,
      minifiedSize: 125,
      totalSavings: 75,
      averageSavings: 37.5,
    });
    assertEquals(cache.getTotalSavings().includes("37.5%"), true);
  });

  it("reports negative savings when transformation expands output", () => {
    const cache = new CacheManager();
    cache.addBundle("a.css", bundle("a.css", 2, "expanded"));
    assertEquals(cache.getStats().totalSavings, -6);
    assertEquals(cache.getStats().averageSavings, -300);
  });
});
