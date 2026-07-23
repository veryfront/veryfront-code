import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { chunkArray, ImageOptimizer } from "./optimizer-core.ts";
import type { OptimizedImageMetadata } from "./types.ts";

function populateManifest(
  optimizer: ImageOptimizer,
  entries: Array<[string, OptimizedImageMetadata]>,
): void {
  // Access private imageManifest for testing — TypeScript private is compile-time only
  const manifest = (optimizer as unknown as { imageManifest: Map<string, OptimizedImageMetadata> })
    .imageManifest;
  for (const [key, value] of entries) {
    manifest.set(key, value);
  }
}

const sampleMetadata: OptimizedImageMetadata = {
  original: "photo.jpg",
  originalSize: 20_000,
  variants: [
    { format: "webp", size: 320, width: 320, height: 180, path: "photo-320w.webp", fileSize: 5000 },
    {
      format: "webp",
      size: 640,
      width: 640,
      height: 360,
      path: "photo-640w.webp",
      fileSize: 12000,
    },
    { format: "avif", size: 320, width: 320, height: 180, path: "photo-320w.avif", fileSize: 4000 },
  ],
  defaultFormat: "webp",
  aspectRatio: 16 / 9,
};

describe("build/asset-pipeline/image-optimizer/optimizer-core", () => {
  describe("chunkArray", () => {
    it("should split array into chunks of given size", () => {
      const result = chunkArray([1, 2, 3, 4, 5], 2);
      assertEquals(result, [[1, 2], [3, 4], [5]], "should create chunks of 2");
    });

    it("should return single chunk when array is smaller than chunk size", () => {
      const result = chunkArray([1, 2], 5);
      assertEquals(result, [[1, 2]], "should return single chunk");
    });

    it("should return empty array for empty input", () => {
      const result = chunkArray([], 3);
      assertEquals(result, [], "should return empty array");
    });

    it("should return array wrapped in single chunk when size equals length", () => {
      const result = chunkArray([1, 2, 3], 3);
      assertEquals(result, [[1, 2, 3]], "should return single chunk");
    });

    it("rejects non-positive chunk sizes", () => {
      assertThrows(() => chunkArray([1, 2, 3], 0), TypeError, "positive integer");
      assertThrows(() => chunkArray([1, 2, 3], -1), TypeError, "positive integer");
    });

    it("should handle chunk size of 1", () => {
      const result = chunkArray(["a", "b", "c"], 1);
      assertEquals(result, [["a"], ["b"], ["c"]], "should create individual chunks");
    });
  });

  describe("ImageOptimizer", () => {
    describe("getImageMetadata", () => {
      it("should return null when no images have been processed", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        assertEquals(
          optimizer.getImageMetadata("test.jpg"),
          null,
          "should return null for unknown image",
        );
      });

      it("should return metadata for a known image", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        populateManifest(optimizer, [["photo.jpg", sampleMetadata]]);

        const result = optimizer.getImageMetadata("photo.jpg");
        assertEquals(result?.original, "photo.jpg", "should return correct original path");
        assertEquals(result?.variants.length, 3, "should have 3 variants");
        assertEquals(result?.defaultFormat, "webp", "should have correct default format");
      });

      it("does not expose mutable manifest metadata", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        populateManifest(optimizer, [["photo.jpg", sampleMetadata]]);

        const result = optimizer.getImageMetadata("photo.jpg");
        result?.variants.splice(0);
        assertEquals(optimizer.getImageMetadata("photo.jpg")?.variants.length, 3);
      });

      it("should return null for a path not in manifest", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        populateManifest(optimizer, [["photo.jpg", sampleMetadata]]);

        assertEquals(
          optimizer.getImageMetadata("other.jpg"),
          null,
          "should return null for unknown path",
        );
      });
    });

    describe("generateSrcSet", () => {
      it("rejects an image that is not in the manifest", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        assertThrows(
          () => optimizer.generateSrcSet("unknown.jpg"),
          TypeError,
          "Image metadata was not found",
        );
      });

      it("should generate srcset for known image with default format", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        populateManifest(optimizer, [["photo.jpg", sampleMetadata]]);

        const srcSet = optimizer.generateSrcSet("photo.jpg");
        assertEquals(typeof srcSet, "string", "should return a string");
        assertEquals(srcSet.length > 0, true, "should return non-empty srcset");
        assertEquals(srcSet.includes("320w"), true, "should include 320w descriptor");
        assertEquals(srcSet.includes("640w"), true, "should include 640w descriptor");
        assertEquals(
          srcSet.includes(Deno.cwd()),
          false,
          "should not expose the filesystem output directory",
        );
        assertEquals(
          srcSet.startsWith("/.veryfront/optimized-images/"),
          true,
          "should use the configured public path",
        );
      });

      it("should filter by specified format", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        populateManifest(optimizer, [["photo.jpg", sampleMetadata]]);

        const srcSet = optimizer.generateSrcSet("photo.jpg", "avif");
        assertEquals(srcSet.includes("avif"), true, "should contain avif paths");
        // avif only has 320w variant
        assertEquals(srcSet.includes("640w"), false, "should not include webp-only sizes");
      });
    });

    describe("getStats", () => {
      it("should return zero stats when no images processed", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        const stats = optimizer.getStats();
        assertEquals(stats.totalImages, 0, "should have zero images");
        assertEquals(stats.totalVariants, 0, "should have zero variants");
        assertEquals(stats.totalSize, 0, "should have zero size");
        assertEquals(stats.averageSavings, 0, "should have zero average savings");
      });

      it("should aggregate stats from populated manifest", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        populateManifest(optimizer, [["photo.jpg", sampleMetadata]]);

        const stats = optimizer.getStats();
        assertEquals(stats.totalImages, 1, "should count one image");
        assertEquals(stats.totalVariants, 3, "should count all 3 variants");
        assertEquals(stats.totalSize, 5000 + 12000 + 4000, "should sum all variant file sizes");
        assertEquals(stats.averageSavings, 65, "should calculate average percentage savings");
      });

      it("should aggregate stats across multiple images", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        const secondImage: OptimizedImageMetadata = {
          original: "banner.png",
          originalSize: 40_000,
          variants: [
            {
              format: "webp",
              size: 1920,
              width: 1920,
              height: 400,
              path: "banner-1920w.webp",
              fileSize: 30000,
            },
          ],
          defaultFormat: "webp",
          aspectRatio: 1920 / 400,
        };
        populateManifest(optimizer, [
          ["photo.jpg", sampleMetadata],
          ["banner.png", secondImage],
        ]);

        const stats = optimizer.getStats();
        assertEquals(stats.totalImages, 2, "should count both images");
        assertEquals(stats.totalVariants, 4, "should count all variants across images");
        assertEquals(stats.totalSize, 21000 + 30000, "should sum all file sizes");
        assertEquals(stats.averageSavings, 45, "should average savings across source images");
      });
    });

    describe("constructor", () => {
      it("should accept empty options", () => {
        const optimizer = new ImageOptimizer();
        assertEquals(optimizer.getStats().totalImages, 0, "new optimizer should have no images");
      });

      it("should accept custom formats and sizes", () => {
        const optimizer = new ImageOptimizer({
          formats: ["webp", "avif"],
          sizes: [320, 640, 1280],
          quality: 85,
        });
        assertEquals(optimizer.getStats().totalImages, 0, "should start with no images");
      });

      it("rejects an unsafe public path", () => {
        assertThrows(
          () => new ImageOptimizer({ publicPath: "relative/images" }),
          TypeError,
          "publicPath",
        );
      });

      it("rejects invalid quality, sizes, formats, and directory layouts", () => {
        assertThrows(() => new ImageOptimizer({ quality: 0 }), TypeError, "quality");
        assertThrows(() => new ImageOptimizer({ sizes: [0] }), TypeError, "sizes");
        assertThrows(() => new ImageOptimizer({ sizes: [] }), TypeError, "sizes");
        assertThrows(() => new ImageOptimizer({ sizes: [400, 400] }), TypeError, "duplicates");
        assertThrows(
          () => new ImageOptimizer({ formats: ["webp", "webp"] }),
          TypeError,
          "duplicates",
        );
        assertThrows(
          () => new ImageOptimizer({ formats: ["gif" as never] }),
          TypeError,
          "format",
        );
        assertThrows(
          () => new ImageOptimizer({ inputDir: "/images", outputDir: "/images/generated" }),
          TypeError,
          "must not contain each other",
        );
        assertThrows(
          () => new ImageOptimizer({ inputDir: "/project/images", outputDir: "/project" }),
          TypeError,
          "must not contain each other",
        );
        assertThrows(
          () => new ImageOptimizer({ inputDir: "/images", outputDir: "/images/..generated" }),
          TypeError,
          "must not contain each other",
        );
        assertThrows(
          () => new ImageOptimizer({ inputDir: "/workspace/..images", outputDir: "/workspace" }),
          TypeError,
          "must not contain each other",
        );
      });
    });

    describe("init", () => {
      it("should return false when disabled", async () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        const ready = await optimizer.init();
        assertEquals(ready, false, "should not be ready when disabled");
      });

      it("returns a detached manifest when optimization is disabled", async () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        const result = await optimizer.optimize();
        result.set("forged.jpg", sampleMetadata);
        assertEquals(optimizer.getImageMetadata("forged.jpg"), null);
      });
    });

    describe("optimization transaction", () => {
      const onePixelPng = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        ),
        (character) => character.charCodeAt(0),
      );

      it("commits complete image output and source-size metadata", async () => {
        const root = await Deno.makeTempDir();
        const inputDir = join(root, "public");
        const outputDir = join(root, "optimized");
        try {
          await Deno.mkdir(inputDir);
          await Deno.writeFile(join(inputDir, "pixel.png"), onePixelPng);
          const optimizer = new ImageOptimizer({
            inputDir,
            outputDir,
            formats: ["png"],
            sizes: [1],
          });

          const manifest = await optimizer.optimize();
          assertEquals(manifest.get("pixel.png")?.originalSize, onePixelPng.length);
          assertEquals(manifest.get("pixel.png")?.variants.length, 1);
          await Deno.stat(join(outputDir, "pixel-1w.png"));
          await Deno.stat(join(outputDir, "image-manifest.json"));
        } finally {
          await Deno.remove(root, { recursive: true });
        }
      });

      it("preserves the previous output directory when optimization fails", async () => {
        const root = await Deno.makeTempDir();
        const inputDir = join(root, "public");
        const outputDir = join(root, "optimized");
        try {
          await Deno.mkdir(inputDir);
          await Deno.mkdir(outputDir);
          await Deno.writeTextFile(join(outputDir, "marker.txt"), "previous output");
          await Deno.writeTextFile(join(inputDir, "broken.png"), "not an image");
          const optimizer = new ImageOptimizer({
            inputDir,
            outputDir,
            formats: ["png"],
            sizes: [1],
          });

          await assertRejects(() => optimizer.optimize());
          assertEquals(
            await Deno.readTextFile(join(outputDir, "marker.txt")),
            "previous output",
          );
          assertEquals(optimizer.getStats().totalImages, 0);
        } finally {
          await Deno.remove(root, { recursive: true });
        }
      });

      it("rejects source files that map to the same variant stem", async () => {
        const root = await Deno.makeTempDir();
        const inputDir = join(root, "public");
        const outputDir = join(root, "optimized");
        try {
          await Deno.mkdir(inputDir);
          await Deno.writeFile(join(inputDir, "logo.png"), onePixelPng);
          await Deno.writeFile(join(inputDir, "logo.jpg"), onePixelPng);
          const optimizer = new ImageOptimizer({ inputDir, outputDir });

          await assertRejects(() => optimizer.optimize(), TypeError, "output stem");
        } finally {
          await Deno.remove(root, { recursive: true });
        }
      });
    });
  });
});
