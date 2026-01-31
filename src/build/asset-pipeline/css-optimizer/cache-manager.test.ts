import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { readTextFile, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { ensureDir } from "#veryfront/compat/std/fs.ts";
import { CacheManager, loadCSSManifest } from "./css-bundle-cache.ts";
import type { CSSBundle } from "#veryfront/types";

const TEST_DIR = "./.veryfront/test-cache";

async function cleanupTestDir(): Promise<void> {
  try {
    await remove(TEST_DIR, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
}

function createBundle(
  file: string,
  size: number,
  minifiedSize: number,
  content: string,
  sourceMap?: string,
): CSSBundle {
  return {
    file,
    content,
    sourceMap,
    size,
    minifiedSize,
    savings: 50,
  };
}

describe("CacheManager", () => {
  it("addBundle and getBundle", () => {
    const cache = new CacheManager();

    cache.addBundle(
      "test.css",
      createBundle("test.css", 100, 50, ".test { color: red; }"),
    );

    const retrieved = cache.getBundle("test.css");
    assertExists(retrieved);
    assertEquals(retrieved.file, "test.css");
    assertEquals(retrieved.size, 100);
  });

  it("getAllBundles", () => {
    const cache = new CacheManager();

    cache.addBundle("a.css", createBundle("a.css", 10, 5, ".a {}"));
    cache.addBundle("b.css", createBundle("b.css", 20, 10, ".b {}"));

    const bundles = cache.getAllBundles();
    assertEquals(bundles.size, 2);
  });

  it("clear", () => {
    const cache = new CacheManager();

    cache.addBundle("test.css", createBundle("test.css", 10, 5, ".test {}"));

    assertEquals(cache.size(), 1);

    cache.clear();
    assertEquals(cache.size(), 0);
  });

  it("getStats", () => {
    const cache = new CacheManager();

    cache.addBundle("test.css", createBundle("test.css", 1000, 500, ".test {}"));

    const stats = cache.getStats();

    assertEquals(stats.totalFiles, 1);
    assertEquals(stats.originalSize, 1000);
    assertEquals(stats.minifiedSize, 500);
    assertEquals(stats.totalSavings, 500);
    assertEquals(stats.averageSavings, 50);
  });

  it("getStats with multiple bundles", () => {
    const cache = new CacheManager();

    cache.addBundle("a.css", createBundle("a.css", 1000, 500, ".a {}"));
    cache.addBundle("b.css", createBundle("b.css", 2000, 1000, ".b {}"));

    const stats = cache.getStats();

    assertEquals(stats.totalFiles, 2);
    assertEquals(stats.originalSize, 3000);
    assertEquals(stats.minifiedSize, 1500);
    assertEquals(stats.totalSavings, 1500);
    assertEquals(stats.averageSavings, 50);
  });

  it("writeManifest", async () => {
    await cleanupTestDir();

    const cache = new CacheManager();

    cache.addBundle(
      "test.css",
      createBundle(
        "test.css",
        100,
        50,
        ".test { color: red; }",
        "source-map-content",
      ),
    );

    await cache.writeManifest(TEST_DIR);

    const manifestPath = join(TEST_DIR, "css-manifest.json");
    const parsed = JSON.parse(await readTextFile(manifestPath));

    assertExists(parsed["test.css"]);
    assertEquals(parsed["test.css"].file, "test.css");
    assertEquals(parsed["test.css"].size, 100);

    // Content and sourceMap should be excluded
    assertEquals(parsed["test.css"].content, undefined);
    assertEquals(parsed["test.css"].sourceMap, undefined);

    await cleanupTestDir();
  });

  it("getTotalSavings format", () => {
    const cache = new CacheManager();

    cache.addBundle("test.css", createBundle("test.css", 10240, 5120, ".test {}"));

    const savings = cache.getTotalSavings();

    assertEquals(typeof savings, "string");
    assertEquals(savings.includes("KB"), true);
    assertEquals(savings.includes("→"), true);
    assertEquals(savings.includes("%"), true);
  });
});

describe("loadCSSManifest", () => {
  it("loads valid manifest", async () => {
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

    await writeTextFile(
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

  it("handles missing manifest", async () => {
    await cleanupTestDir();

    const loaded = await loadCSSManifest(TEST_DIR);
    assertEquals(loaded.size, 0);

    await cleanupTestDir();
  });

  it("handles corrupted manifest", async () => {
    await cleanupTestDir();
    await ensureDir(TEST_DIR);

    await writeTextFile(join(TEST_DIR, "css-manifest.json"), "invalid{json}");

    const loaded = await loadCSSManifest(TEST_DIR);
    assertEquals(loaded.size, 0);

    await cleanupTestDir();
  });
});
