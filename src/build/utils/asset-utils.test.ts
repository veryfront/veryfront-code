import { describe, it, beforeEach, afterEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import {
  CSS_EXTENSIONS,
  findCSSFiles,
  isPseudoSelector,
  getStandardPseudoSelectors,
  getVariantPath,
  generateSrcSet,
  calculateAspectRatio,
  getImageDimensions,
} from "./asset-utils.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";
import type { OptimizedImageMetadata } from "../asset-pipeline/image-optimizer/types.ts";

const fs = createFileSystem();

describe("asset-utils", () => {
  describe("CSS_EXTENSIONS", () => {
    it("should include common CSS extensions", () => {
      assertEquals(CSS_EXTENSIONS.includes(".css"), true);
      assertEquals(CSS_EXTENSIONS.includes(".scss"), true);
      assertEquals(CSS_EXTENSIONS.includes(".sass"), true);
      assertEquals(CSS_EXTENSIONS.includes(".less"), true);
    });
  });

  describe("findCSSFiles", () => {
    const testDir = "/tmp/css-find-test";

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

    it("should find CSS files in directory", async () => {
      await fs.writeTextFile(`${testDir}/test.css`, ".test { color: red; }");

      const files = await findCSSFiles(testDir);

      assertEquals(files.length >= 1, true);
    });

    it("should return empty array for non-existent directory", async () => {
      const files = await findCSSFiles("/tmp/non-existent-dir-xyz");
      assertEquals(Array.isArray(files), true);
      assertEquals(files.length, 0);
    });

    it("should handle empty directory", async () => {
      const files = await findCSSFiles(testDir);
      assertEquals(Array.isArray(files), true);
    });
  });

  describe("isPseudoSelector", () => {
    it("should return true for pseudo selectors", () => {
      assertEquals(isPseudoSelector(":hover"), true);
      assertEquals(isPseudoSelector(":focus"), true);
      assertEquals(isPseudoSelector("::before"), true);
      assertEquals(isPseudoSelector(".class:hover"), true);
    });

    it("should return false for regular selectors", () => {
      assertEquals(isPseudoSelector(".class"), false);
      assertEquals(isPseudoSelector("#id"), false);
      assertEquals(isPseudoSelector("div"), false);
    });
  });

  describe("getStandardPseudoSelectors", () => {
    it("should return array of pseudo selectors", () => {
      const selectors = getStandardPseudoSelectors();
      assertEquals(Array.isArray(selectors), true);
      assertEquals(selectors.length > 0, true);
    });

    it("should include common pseudo selectors", () => {
      const selectors = getStandardPseudoSelectors();
      assertEquals(selectors.includes(":hover"), true);
      assertEquals(selectors.includes(":focus"), true);
      assertEquals(selectors.includes(":active"), true);
      assertEquals(selectors.includes("::before"), true);
      assertEquals(selectors.includes("::after"), true);
    });
  });

  describe("getVariantPath", () => {
    it("should generate variant path with size and format", () => {
      const path = getVariantPath("/output", "images/test.jpg", "webp", 640);
      assertEquals(path.includes("test"), true);
      assertEquals(path.includes("640w"), true);
      assertEquals(path.includes(".webp"), true);
    });

    it("should preserve directory structure", () => {
      const path = getVariantPath("/output", "subdir/image.png", "avif", 1024);
      assertEquals(path.includes("subdir"), true);
    });

    it("should handle different formats", () => {
      const webp = getVariantPath("/out", "img.jpg", "webp", 800);
      const avif = getVariantPath("/out", "img.jpg", "avif", 800);
      const jpeg = getVariantPath("/out", "img.jpg", "jpeg", 800);

      assertEquals(webp.endsWith(".webp"), true);
      assertEquals(avif.endsWith(".avif"), true);
      assertEquals(jpeg.endsWith(".jpeg"), true);
    });
  });

  describe("generateSrcSet", () => {
    it("should generate srcset string from metadata", () => {
      const metadata: OptimizedImageMetadata = {
        original: "test.jpg",
        defaultFormat: "webp",
        aspectRatio: 1.33,
        variants: [
          { path: "test-640w.webp", width: 640, height: 480, format: "webp", size: 640, fileSize: 1000 },
          { path: "test-1024w.webp", width: 1024, height: 768, format: "webp", size: 1024, fileSize: 2000 },
        ],
      };

      const srcset = generateSrcSet("test.jpg", metadata, "/images");

      assertExists(srcset);
      assertEquals(typeof srcset, "string");
      assertEquals(srcset.includes("640w"), true);
      assertEquals(srcset.includes("1024w"), true);
    });

    it("should filter variants by format", () => {
      const metadata: OptimizedImageMetadata = {
        original: "test.jpg",
        defaultFormat: "webp",
        aspectRatio: 1.33,
        variants: [
          { path: "test-640w.webp", width: 640, height: 480, format: "webp", size: 640, fileSize: 1000 },
          { path: "test-640w.avif", width: 640, height: 480, format: "avif", size: 640, fileSize: 800 },
        ],
      };

      const srcset = generateSrcSet("test.jpg", metadata, "/images", "avif");

      assertEquals(srcset.includes("avif"), true);
      assertEquals(srcset.includes("webp"), false);
    });

    it("should use default format when not specified", () => {
      const metadata: OptimizedImageMetadata = {
        original: "test.jpg",
        defaultFormat: "webp",
        aspectRatio: 1.33,
        variants: [
          { path: "test-640w.webp", width: 640, height: 480, format: "webp", size: 640, fileSize: 1000 },
        ],
      };

      const srcset = generateSrcSet("test.jpg", metadata, "/images");

      assertEquals(srcset.includes("webp"), true);
    });
  });

  describe("calculateAspectRatio", () => {
    it("should calculate aspect ratio from width and height", () => {
      assertEquals(calculateAspectRatio(1920, 1080), 1920 / 1080);
      assertEquals(calculateAspectRatio(800, 600), 800 / 600);
    });

    it("should return 1 when width is undefined", () => {
      assertEquals(calculateAspectRatio(undefined, 600), 1);
    });

    it("should return 1 when height is undefined", () => {
      assertEquals(calculateAspectRatio(800, undefined), 1);
    });

    it("should return 1 when both are undefined", () => {
      assertEquals(calculateAspectRatio(undefined, undefined), 1);
    });

    it("should handle square images", () => {
      assertEquals(calculateAspectRatio(1000, 1000), 1);
    });
  });

  describe("getImageDimensions", () => {
    it("should extract dimensions from metadata", () => {
      const metadata: OptimizedImageMetadata = {
        original: "test.jpg",
        defaultFormat: "webp",
        aspectRatio: 1.33,
        variants: [
          { path: "test-640w.webp", width: 640, height: 480, format: "webp", size: 640, fileSize: 1000 },
        ],
      };

      const dimensions = getImageDimensions(metadata);

      assertEquals(dimensions.width, 640);
      assertEquals(dimensions.height, 480);
    });

    it("should prefer variant with default format", () => {
      const metadata: OptimizedImageMetadata = {
        original: "test.jpg",
        defaultFormat: "webp",
        aspectRatio: 1.33,
        variants: [
          { path: "test-640w.avif", width: 800, height: 600, format: "avif", size: 640, fileSize: 800 },
          { path: "test-640w.webp", width: 640, height: 480, format: "webp", size: 640, fileSize: 1000 },
        ],
      };

      const dimensions = getImageDimensions(metadata);

      assertEquals(dimensions.width, 640);
      assertEquals(dimensions.height, 480);
    });

    it("should use first variant if default format not found", () => {
      const metadata: OptimizedImageMetadata = {
        original: "test.jpg",
        defaultFormat: "jpeg",
        aspectRatio: 1.33,
        variants: [
          { path: "test-640w.webp", width: 640, height: 480, format: "webp", size: 640, fileSize: 1000 },
        ],
      };

      const dimensions = getImageDimensions(metadata);

      assertEquals(dimensions.width, 640);
      assertEquals(dimensions.height, 480);
    });
  });
});
