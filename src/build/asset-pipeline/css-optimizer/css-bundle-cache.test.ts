import { describe, it, beforeEach, afterEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { CacheManager, loadCSSManifest } from "./css-bundle-cache.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";
import type { CSSBundle } from "@veryfront/types";

const fs = createFileSystem();

describe("CacheManager", () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager();
  });

  it("should add and retrieve bundles", () => {
    const bundle: CSSBundle = {
      content: ".test { color: red; }",
      size: 100,
      minifiedSize: 80,
      savings: 20,
      file: "/test.css",
    };

    cache.addBundle("test", bundle);
    const retrieved = cache.getBundle("test");

    assertExists(retrieved);
    assertEquals(retrieved.content, bundle.content);
  });

  it("should return undefined for non-existent bundle", () => {
    const bundle = cache.getBundle("nonexistent");
    assertEquals(bundle, undefined);
  });

  it("should return all bundles", () => {
    const bundle1: CSSBundle = {
      content: ".test1 { color: red; }",
      size: 100,
      minifiedSize: 80,
      savings: 20,
      file: "/test1.css",
    };
    const bundle2: CSSBundle = {
      content: ".test2 { color: blue; }",
      size: 150,
      minifiedSize: 120,
      savings: 20,
      file: "/test2.css",
    };

    cache.addBundle("test1", bundle1);
    cache.addBundle("test2", bundle2);

    const allBundles = cache.getAllBundles();
    assertEquals(allBundles.size, 2);
    assertEquals(allBundles.has("test1"), true);
    assertEquals(allBundles.has("test2"), true);
  });

  it("should clear all bundles", () => {
    const bundle: CSSBundle = {
      content: ".test { color: red; }",
      size: 100,
      minifiedSize: 80,
      savings: 20,
      file: "/test.css",
    };

    cache.addBundle("test", bundle);
    assertEquals(cache.size(), 1);

    cache.clear();
    assertEquals(cache.size(), 0);
  });

  it("should return correct size", () => {
    assertEquals(cache.size(), 0);

    cache.addBundle("test1", {
      content: ".test1 { color: red; }",
      size: 100,
      minifiedSize: 80,
      savings: 20,
      file: "/test1.css",
    });
    assertEquals(cache.size(), 1);

    cache.addBundle("test2", {
      content: ".test2 { color: blue; }",
      size: 150,
      minifiedSize: 120,
      savings: 20,
      file: "/test2.css",
    });
    assertEquals(cache.size(), 2);
  });

  it("should calculate stats correctly", () => {
    cache.addBundle("test1", {
      content: ".test1 { color: red; }",
      size: 100,
      minifiedSize: 80,
      savings: 20,
      file: "/test1.css",
    });
    cache.addBundle("test2", {
      content: ".test2 { color: blue; }",
      size: 200,
      minifiedSize: 160,
      savings: 20,
      file: "/test2.css",
    });

    const stats = cache.getStats();

    assertEquals(stats.totalFiles, 2);
    assertEquals(stats.originalSize, 300);
    assertEquals(stats.minifiedSize, 240);
    assertEquals(stats.totalSavings, 60);
    assertEquals(stats.averageSavings, 20);
  });

  it("should handle stats with no bundles", () => {
    const stats = cache.getStats();

    assertEquals(stats.totalFiles, 0);
    assertEquals(stats.originalSize, 0);
    assertEquals(stats.minifiedSize, 0);
    assertEquals(stats.totalSavings, 0);
    assertEquals(stats.averageSavings, 0);
  });

  it("should cache stats calculations", () => {
    cache.addBundle("test", {
      content: ".test { color: red; }",
      size: 100,
      minifiedSize: 80,
      savings: 20,
      file: "/test.css",
    });

    const stats1 = cache.getStats();
    const stats2 = cache.getStats();

    // Both should be the same reference (cached)
    assertEquals(stats1, stats2);
  });

  it("should invalidate stats cache when adding bundle", () => {
    cache.addBundle("test1", {
      content: ".test1 { color: red; }",
      size: 100,
      minifiedSize: 80,
      savings: 20,
      file: "/test1.css",
    });

    const stats1 = cache.getStats();
    assertEquals(stats1.totalFiles, 1);

    cache.addBundle("test2", {
      content: ".test2 { color: blue; }",
      size: 150,
      minifiedSize: 120,
      savings: 20,
      file: "/test2.css",
    });

    const stats2 = cache.getStats();
    assertEquals(stats2.totalFiles, 2);
  });

  it("should invalidate stats cache when clearing", () => {
    cache.addBundle("test", {
      content: ".test { color: red; }",
      size: 100,
      minifiedSize: 80,
      savings: 20,
      file: "/test.css",
    });

    cache.getStats();
    cache.clear();

    const stats = cache.getStats();
    assertEquals(stats.totalFiles, 0);
  });

  it("should format total savings correctly", () => {
    cache.addBundle("test", {
      content: ".test { color: red; }",
      size: 1024,
      minifiedSize: 512,
      savings: 50,
      file: "/test.css",
    });

    const savings = cache.getTotalSavings();
    assertExists(savings);
    assertEquals(typeof savings, "string");
    assertEquals(savings.includes("KB"), true);
    assertEquals(savings.includes("→"), true);
    assertEquals(savings.includes("%"), true);
  });

  it("should handle zero savings", () => {
    cache.addBundle("test", {
      content: ".test { color: red; }",
      size: 100,
      minifiedSize: 100,
      savings: 0,
      file: "/test.css",
    });

    const savings = cache.getTotalSavings();
    assertExists(savings);
    assertEquals(savings.includes("0.0%"), true);
  });
});

describe("CacheManager.writeManifest", () => {
  let cache: CacheManager;
  const testDir = "/tmp/css-cache-test";

  beforeEach(async () => {
    cache = new CacheManager();
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should write manifest to file", async () => {
    cache.addBundle("test", {
      content: ".test { color: red; }",
      size: 100,
      minifiedSize: 80,
      savings: 20,
      file: "/test.css",
    });

    await cache.writeManifest(testDir);

    const manifestPath = `${testDir}/css-manifest.json`;
    const exists = await fs.exists(manifestPath);
    assertEquals(exists, true);
  });

  it("should exclude content and sourceMap from manifest", async () => {
    cache.addBundle("test", {
      content: ".test { color: red; }",
      sourceMap: "source map data",
      size: 100,
      minifiedSize: 80,
      savings: 20,
      file: "/test.css",
    });

    await cache.writeManifest(testDir);

    const manifestPath = `${testDir}/css-manifest.json`;
    const content = await fs.readTextFile(manifestPath);
    const data = JSON.parse(content);

    assertEquals(data.test.content, undefined);
    assertEquals(data.test.sourceMap, undefined);
    assertExists(data.test.size);
    assertExists(data.test.minifiedSize);
  });

  it("should create output directory if it doesn't exist", async () => {
    const nestedDir = `${testDir}/nested/deep`;

    cache.addBundle("test", {
      content: ".test { color: red; }",
      size: 100,
      minifiedSize: 80,
      savings: 20,
      file: "/test.css",
    });

    await cache.writeManifest(nestedDir);

    const manifestPath = `${nestedDir}/css-manifest.json`;
    const exists = await fs.exists(manifestPath);
    assertEquals(exists, true);
  });
});

describe("loadCSSManifest", () => {
  const testDir = "/tmp/css-manifest-test";

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should load manifest from file", async () => {
    const manifestData = {
      test: {
        size: 100,
        minifiedSize: 80,
        file: "/test.css",
      },
    };

    await fs.writeTextFile(
      `${testDir}/css-manifest.json`,
      JSON.stringify(manifestData),
    );

    const bundles = await loadCSSManifest(testDir);

    assertEquals(bundles.size, 1);
    assertEquals(bundles.has("test"), true);
    const bundle = bundles.get("test");
    assertExists(bundle);
    assertEquals(bundle.size, 100);
  });

  it("should return empty map when manifest doesn't exist", async () => {
    const bundles = await loadCSSManifest(`${testDir}/nonexistent`);

    assertEquals(bundles.size, 0);
    assertExists(bundles);
  });

  it("should return empty map when manifest is invalid JSON", async () => {
    await fs.writeTextFile(
      `${testDir}/css-manifest.json`,
      "invalid json",
    );

    const bundles = await loadCSSManifest(testDir);

    assertEquals(bundles.size, 0);
  });

  it("should handle multiple bundles", async () => {
    const manifestData = {
      test1: {
        size: 100,
        minifiedSize: 80,
        file: "/test1.css",
      },
      test2: {
        size: 200,
        minifiedSize: 160,
        file: "/test2.css",
      },
    };

    await fs.writeTextFile(
      `${testDir}/css-manifest.json`,
      JSON.stringify(manifestData),
    );

    const bundles = await loadCSSManifest(testDir);

    assertEquals(bundles.size, 2);
    assertEquals(bundles.has("test1"), true);
    assertEquals(bundles.has("test2"), true);
  });
});
