/**
 * Tests for CSS Cache Manager
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import { CacheManager, loadCSSManifest } from "./css-bundle-cache.ts";
import type { CSSBundle } from "@veryfront/types";

const TEST_DIR = "./.veryfront/test-cache";

async function cleanupTestDir() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
}

Deno.test("CacheManager - addBundle and getBundle", () => {
  const cache = new CacheManager();

  const bundle: CSSBundle = {
    file: "test.css",
    content: ".test { color: red; }",
    size: 100,
    minifiedSize: 50,
    savings: 50,
  };

  cache.addBundle("test.css", bundle);

  const retrieved = cache.getBundle("test.css");
  assertExists(retrieved);
  assertEquals(retrieved.file, "test.css");
  assertEquals(retrieved.size, 100);
});

Deno.test("CacheManager - getAllBundles", () => {
  const cache = new CacheManager();

  cache.addBundle("a.css", {
    file: "a.css",
    content: ".a {}",
    size: 10,
    minifiedSize: 5,
    savings: 50,
  });

  cache.addBundle("b.css", {
    file: "b.css",
    content: ".b {}",
    size: 20,
    minifiedSize: 10,
    savings: 50,
  });

  const bundles = cache.getAllBundles();
  assertEquals(bundles.size, 2);
});

Deno.test("CacheManager - clear", () => {
  const cache = new CacheManager();

  cache.addBundle("test.css", {
    file: "test.css",
    content: ".test {}",
    size: 10,
    minifiedSize: 5,
    savings: 50,
  });

  assertEquals(cache.size(), 1);

  cache.clear();
  assertEquals(cache.size(), 0);
});

Deno.test("CacheManager - getStats", () => {
  const cache = new CacheManager();

  cache.addBundle("test.css", {
    file: "test.css",
    content: ".test {}",
    size: 1000,
    minifiedSize: 500,
    savings: 50,
  });

  const stats = cache.getStats();

  assertEquals(stats.totalFiles, 1);
  assertEquals(stats.originalSize, 1000);
  assertEquals(stats.minifiedSize, 500);
  assertEquals(stats.totalSavings, 500);
  assertEquals(stats.averageSavings, 50);
});

Deno.test("CacheManager - getStats with multiple bundles", () => {
  const cache = new CacheManager();

  cache.addBundle("a.css", {
    file: "a.css",
    content: ".a {}",
    size: 1000,
    minifiedSize: 500,
    savings: 50,
  });

  cache.addBundle("b.css", {
    file: "b.css",
    content: ".b {}",
    size: 2000,
    minifiedSize: 1000,
    savings: 50,
  });

  const stats = cache.getStats();

  assertEquals(stats.totalFiles, 2);
  assertEquals(stats.originalSize, 3000);
  assertEquals(stats.minifiedSize, 1500);
  assertEquals(stats.totalSavings, 1500);
  assertEquals(stats.averageSavings, 50);
});

Deno.test("CacheManager - writeManifest", async () => {
  await cleanupTestDir();

  const cache = new CacheManager();

  cache.addBundle("test.css", {
    file: "test.css",
    content: ".test { color: red; }",
    sourceMap: "source-map-content",
    size: 100,
    minifiedSize: 50,
    savings: 50,
  });

  await cache.writeManifest(TEST_DIR);

  const manifestPath = join(TEST_DIR, "css-manifest.json");
  const content = await Deno.readTextFile(manifestPath);
  const parsed = JSON.parse(content);

  assertExists(parsed["test.css"]);
  assertEquals(parsed["test.css"].file, "test.css");
  assertEquals(parsed["test.css"].size, 100);

  // Content and sourceMap should be excluded
  assertEquals(parsed["test.css"].content, undefined);
  assertEquals(parsed["test.css"].sourceMap, undefined);

  await cleanupTestDir();
});

Deno.test("loadCSSManifest - loads valid manifest", async () => {
  await cleanupTestDir();
  await ensureDir(TEST_DIR);

  const manifest = {
    "test.css": {
      file: "test.css",
      size: 100,
      minifiedSize: 50,
      savings: 50,
    },
  };

  await Deno.writeTextFile(
    join(TEST_DIR, "css-manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  const loaded = await loadCSSManifest(TEST_DIR);

  assertEquals(loaded.size, 1);
  const bundle = loaded.get("test.css");
  assertExists(bundle);
  assertEquals(bundle.size, 100);

  await cleanupTestDir();
});

Deno.test("loadCSSManifest - handles missing manifest", async () => {
  await cleanupTestDir();

  const loaded = await loadCSSManifest(TEST_DIR);

  assertEquals(loaded.size, 0);

  await cleanupTestDir();
});

Deno.test("loadCSSManifest - handles corrupted manifest", async () => {
  await cleanupTestDir();
  await ensureDir(TEST_DIR);

  await Deno.writeTextFile(join(TEST_DIR, "css-manifest.json"), "invalid{json}");

  const loaded = await loadCSSManifest(TEST_DIR);

  assertEquals(loaded.size, 0);

  await cleanupTestDir();
});

Deno.test("CacheManager - getTotalSavings format", () => {
  const cache = new CacheManager();

  cache.addBundle("test.css", {
    file: "test.css",
    content: ".test {}",
    size: 10240, // 10KB
    minifiedSize: 5120, // 5KB
    savings: 50,
  });

  const savings = cache.getTotalSavings();

  // Should be formatted like "10.0KB → 5.0KB (50.0%)"
  assertEquals(typeof savings, "string");
  assertEquals(savings.includes("KB"), true);
  assertEquals(savings.includes("→"), true);
  assertEquals(savings.includes("%"), true);
});
