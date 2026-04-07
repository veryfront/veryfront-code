import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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

    it("should return all items in one chunk when chunkSize is 0 or negative", () => {
      assertEquals(chunkArray([1, 2, 3], 0), [[1, 2, 3]], "chunkSize 0 returns single chunk");
      assertEquals(
        chunkArray([1, 2, 3], -1),
        [[1, 2, 3]],
        "negative chunkSize returns single chunk",
      );
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
      it("should return empty string when image is not in manifest", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        assertEquals(
          optimizer.generateSrcSet("unknown.jpg"),
          "",
          "should return empty for unknown",
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
        assertEquals(stats.averageSavings, 21000 / 3, "should calculate average correctly");
      });

      it("should aggregate stats across multiple images", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        const secondImage: OptimizedImageMetadata = {
          original: "banner.png",
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
    });

    describe("init", () => {
      it("should return false when disabled", async () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        const ready = await optimizer.init();
        assertEquals(ready, false, "should not be ready when disabled");
      });
    });
  });
});
