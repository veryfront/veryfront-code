import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { ImageOptimizer } from "./optimizer-core.ts";

// chunkArray is not exported, so we test it indirectly via ImageOptimizer
// and test the public API of ImageOptimizer directly

describe("build/asset-pipeline/image-optimizer/optimizer-core", () => {
  describe("ImageOptimizer", () => {
    describe("getImageMetadata", () => {
      it("should return null when no images have been processed", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        const metadata = optimizer.getImageMetadata("test.jpg");
        assertEquals(metadata, null, "should return null for unknown image");
      });

      it("should return null for non-existent image path", () => {
        const optimizer = new ImageOptimizer();
        assertEquals(
          optimizer.getImageMetadata("nonexistent.png"),
          null,
          "should return null for path not in manifest",
        );
      });
    });

    describe("generateSrcSet", () => {
      it("should return empty string when image is not in manifest", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        const srcSet = optimizer.generateSrcSet("unknown.jpg");
        assertEquals(srcSet, "", "should return empty string for unknown image");
      });

      it("should return empty string for non-existent path", () => {
        const optimizer = new ImageOptimizer();
        assertEquals(
          optimizer.generateSrcSet("nonexistent.png"),
          "",
          "should return empty for missing image",
        );
      });

      it("should return empty string with format parameter for unknown image", () => {
        const optimizer = new ImageOptimizer();
        assertEquals(
          optimizer.generateSrcSet("unknown.jpg", "webp"),
          "",
          "should return empty for unknown image even with format",
        );
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

      it("should return consistent stats object shape", () => {
        const optimizer = new ImageOptimizer();
        const stats = optimizer.getStats();
        assertEquals(typeof stats.totalImages, "number", "totalImages should be a number");
        assertEquals(typeof stats.totalVariants, "number", "totalVariants should be a number");
        assertEquals(typeof stats.totalSize, "number", "totalSize should be a number");
        assertEquals(typeof stats.averageSavings, "number", "averageSavings should be a number");
      });
    });

    describe("constructor", () => {
      it("should accept empty options", () => {
        const optimizer = new ImageOptimizer();
        const stats = optimizer.getStats();
        assertEquals(stats.totalImages, 0, "new optimizer should have no images");
      });

      it("should accept disabled configuration", () => {
        const optimizer = new ImageOptimizer({ enabled: false });
        const stats = optimizer.getStats();
        assertEquals(stats.totalImages, 0, "disabled optimizer should have no images");
      });

      it("should accept custom formats and sizes", () => {
        const optimizer = new ImageOptimizer({
          formats: ["webp", "avif"],
          sizes: [320, 640, 1280],
          quality: 85,
        });
        const stats = optimizer.getStats();
        assertEquals(stats.totalImages, 0, "should start with no images");
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
