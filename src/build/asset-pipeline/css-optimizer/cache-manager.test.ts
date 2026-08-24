import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CacheManager, loadCSSManifest } from "./css-bundle-cache.ts";
import type { CSSBundle } from "./types/index.ts";
import { calculateSavings } from "./utils.ts";

const encoder = new TextEncoder();

function createBundle(
  file: string,
  content: string,
  originalSize = encoder.encode(content).length,
): CSSBundle {
  const minifiedSize = encoder.encode(content).length;
  return {
    file,
    outputFile: `.veryfront/css/${file.replace(/\.css$/i, ".min.css")}`,
    content,
    size: originalSize,
    minifiedSize,
    savings: calculateSavings(originalSize, minifiedSize),
  };
}

async function withTempDir(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir();
  try {
    await callback(directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

describe("build/asset-pipeline/css-optimizer/cache-manager", () => {
  it("stores defensive copies and invalidates statistics", () => {
    const cache = new CacheManager();
    const bundle = createBundle("a.css", "a".repeat(50), 100);
    cache.addBundle("a.css", bundle);
    assertEquals(cache.getStats().averageSavings, 50);

    bundle.content = "mutated";
    assertEquals(cache.getBundle("a.css")?.content, "a".repeat(50));
    const exposed = cache.getAllBundles();
    exposed.get("a.css")!.content = "mutated";
    assertEquals(cache.getBundle("a.css")?.content, "a".repeat(50));

    cache.addBundle("b.css", createBundle("b.css", "b".repeat(25), 100));
    assertEquals(cache.getStats(), {
      totalFiles: 2,
      originalSize: 200,
      minifiedSize: 75,
      totalSavings: 125,
      averageSavings: 62.5,
    });
  });

  it("serializes deterministic, complete manifests", () => {
    const cache = new CacheManager();
    cache.addBundle("z.css", createBundle("z.css", ".z{}"));
    cache.addBundle("a.css", createBundle("a.css", ".a{}"));

    const serialized = cache.serializeManifest();
    assertEquals(serialized.indexOf('"a.css"') < serialized.indexOf('"z.css"'), true);
    assertEquals(serialized.includes('"content": ".a{}"'), true);
    assertEquals(serialized.endsWith("\n"), true);
  });

  it("round-trips complete manifests", async () => {
    await withTempDir(async (directory) => {
      const cache = new CacheManager();
      cache.addBundle("test.css", createBundle("test.css", ".test{}"));
      await cache.writeManifest(directory);

      const loaded = await loadCSSManifest(directory);
      assertEquals(loaded.get("test.css")?.content, ".test{}");
      assertEquals(loaded.get("test.css")?.minifiedSize, 7);
    });
  });

  it("hydrates legacy manifests from their generated CSS file", async () => {
    await withTempDir(async (directory) => {
      const content = ".legacy{}";
      await Deno.writeTextFile(join(directory, "legacy.min.css"), content);
      await Deno.writeTextFile(
        join(directory, "css-manifest.json"),
        JSON.stringify({
          "legacy.css": {
            file: "legacy.css",
            size: 20,
            minifiedSize: encoder.encode(content).length,
            savings: calculateSavings(20, encoder.encode(content).length),
          },
        }),
      );

      const loaded = await loadCSSManifest(directory);
      assertEquals(loaded.get("legacy.css")?.content, content);
    });
  });

  it("returns empty only for an absent manifest", async () => {
    await withTempDir(async (directory) => {
      assertEquals((await loadCSSManifest(directory)).size, 0);
      await Deno.writeTextFile(join(directory, "css-manifest.json"), "{");
      await assertRejects(
        () => loadCSSManifest(directory),
        TypeError,
        "not valid JSON",
      );
    });
  });

  it("rejects malformed entries instead of trusting casts", async () => {
    await withTempDir(async (directory) => {
      await Deno.writeTextFile(
        join(directory, "css-manifest.json"),
        JSON.stringify({
          "../escape.css": {
            file: "../escape.css",
            content: ".x{}",
            size: 4,
            minifiedSize: 4,
            savings: 0,
          },
        }),
      );
      await assertRejects(
        () => loadCSSManifest(directory),
        TypeError,
        "malformed",
      );
    });
  });

  it("rejects case-folded key and output collisions", async () => {
    const entry = (file: string, outputFile: string) => ({
      file,
      outputFile,
      content: ".a{}",
      size: 4,
      minifiedSize: 4,
      savings: calculateSavings(4, 4),
    });

    await withTempDir(async (directory) => {
      await Deno.writeTextFile(
        join(directory, "css-manifest.json"),
        JSON.stringify({
          "A.css": entry("A.css", ".veryfront/css/first.min.css"),
          "a.css": entry("a.css", ".veryfront/css/second.min.css"),
        }),
      );
      await assertRejects(
        () => loadCSSManifest(directory),
        TypeError,
        "path collision",
        "keys differing only in case must be rejected",
      );
    });

    await withTempDir(async (directory) => {
      await Deno.writeTextFile(
        join(directory, "css-manifest.json"),
        JSON.stringify({
          "one.css": entry("one.css", ".veryfront/css/Out.min.css"),
          "two.css": entry("two.css", ".veryfront/css/out.min.css"),
        }),
      );
      await assertRejects(
        () => loadCSSManifest(directory),
        TypeError,
        "path collision",
        "output files differing only in case must be rejected",
      );
    });
  });
});
