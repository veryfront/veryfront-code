import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { OptimizedImageMetadata } from "../asset-pipeline/image-optimizer/types.ts";
import {
  calculateAspectRatio,
  generateSrcSet,
  getImageDimensions,
  getStandardPseudoSelectors,
  getVariantPath,
  isPseudoSelector,
} from "./asset-utils.ts";

describe("build/utils/asset-utils", () => {
  describe("isPseudoSelector", () => {
    it("should detect pseudo selectors", () => {
      assertEquals(isPseudoSelector(":hover"), true);
      assertEquals(isPseudoSelector("::before"), true);
      assertEquals(isPseudoSelector("button:focus"), true);
    });

    it("should reject non-pseudo selectors", () => {
      assertEquals(isPseudoSelector(".class"), false);
      assertEquals(isPseudoSelector("#id"), false);
      assertEquals(isPseudoSelector("div"), false);
    });
  });

  describe("getStandardPseudoSelectors", () => {
    it("should return an array of pseudo selectors", () => {
      const selectors = getStandardPseudoSelectors();
      assertEquals(Array.isArray(selectors), true);
      assertEquals(selectors.length > 0, true);
      assertEquals(selectors.includes(":hover"), true);
      assertEquals(selectors.includes("::before"), true);
      assertEquals(selectors.includes(":focus"), true);
    });
  });

  describe("getVariantPath", () => {
    it("should generate variant path with size and format", () => {
      const result = getVariantPath("/out", "images/hero.jpg", "webp", 800);
      assertEquals(result.includes("hero-800w.webp"), true);
    });

    it("should preserve directory structure", () => {
      const result = getVariantPath("/out", "deep/nested/img.png", "avif", 400);
      assertEquals(result.includes("deep/nested/"), true);
      assertEquals(result.includes("img-400w.avif"), true);
    });
  });

  describe("calculateAspectRatio", () => {
    it("should calculate correct ratio", () => {
      assertEquals(calculateAspectRatio(1920, 1080), 1920 / 1080);
      assertEquals(calculateAspectRatio(100, 100), 1);
    });

    it("should return 1 for undefined dimensions", () => {
      assertEquals(calculateAspectRatio(undefined, 100), 1);
      assertEquals(calculateAspectRatio(100, undefined), 1);
      assertEquals(calculateAspectRatio(undefined, undefined), 1);
    });
  });

  describe("generateSrcSet", () => {
    it("should generate srcset string from variants", () => {
      const metadata: OptimizedImageMetadata = {
        original: "hero.jpg",
        defaultFormat: "webp",
        aspectRatio: 4 / 3,
        variants: [
          {
            path: "hero-400w.webp",
            format: "webp",
            width: 400,
            height: 300,
            size: 1000,
            fileSize: 1000,
          },
          {
            path: "hero-800w.webp",
            format: "webp",
            width: 800,
            height: 600,
            size: 2000,
            fileSize: 2000,
          },
          {
            path: "hero-400w.avif",
            format: "avif",
            width: 400,
            height: 300,
            size: 800,
            fileSize: 800,
          },
        ],
      };
      const srcSet = generateSrcSet("hero.jpg", metadata, "assets");
      assertEquals(srcSet.includes("400w"), true);
      assertEquals(srcSet.includes("800w"), true);
    });

    it("should filter by specified format", () => {
      const metadata: OptimizedImageMetadata = {
        original: "img.jpg",
        defaultFormat: "webp",
        aspectRatio: 4 / 3,
        variants: [
          {
            path: "img-400w.webp",
            format: "webp",
            width: 400,
            height: 300,
            size: 1000,
            fileSize: 1000,
          },
          {
            path: "img-400w.avif",
            format: "avif",
            width: 400,
            height: 300,
            size: 800,
            fileSize: 800,
          },
        ],
      };
      const srcSet = generateSrcSet("img.jpg", metadata, "assets", "avif");
      assertEquals(srcSet.includes("avif"), true);
      assertEquals(srcSet.includes("webp"), false);
    });
  });

  describe("getImageDimensions", () => {
    it("should return dimensions of default format variant", () => {
      const metadata: OptimizedImageMetadata = {
        original: "img.jpg",
        defaultFormat: "webp",
        aspectRatio: 4 / 3,
        variants: [
          {
            path: "img-800w.webp",
            format: "webp",
            width: 800,
            height: 600,
            size: 2000,
            fileSize: 2000,
          },
          {
            path: "img-400w.avif",
            format: "avif",
            width: 400,
            height: 300,
            size: 1000,
            fileSize: 1000,
          },
        ],
      };
      const dims = getImageDimensions(metadata);
      assertEquals(dims.width, 800);
      assertEquals(dims.height, 600);
    });

    it("should fallback to first variant", () => {
      const metadata: OptimizedImageMetadata = {
        original: "img.jpg",
        defaultFormat: "png",
        aspectRatio: 4 / 3,
        variants: [
          {
            path: "img-400w.avif",
            format: "avif",
            width: 400,
            height: 300,
            size: 800,
            fileSize: 800,
          },
        ],
      };
      const dims = getImageDimensions(metadata);
      assertEquals(dims.width, 400);
      assertEquals(dims.height, 300);
    });

    it("should throw if no variants", () => {
      const metadata: OptimizedImageMetadata = {
        original: "img.jpg",
        defaultFormat: "webp",
        aspectRatio: 1,
        variants: [],
      };
      assertThrows(() => getImageDimensions(metadata));
    });
  });
});
