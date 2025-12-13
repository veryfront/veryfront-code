import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import {
  getOptimizedPath,
  generateSrcSet,
  getExtension,
} from "./helpers.ts";

describe("optimized-image helpers", () => {
  describe("getOptimizedPath", () => {
    it("should generate optimized path with format and size", () => {
      const result = getOptimizedPath("/images/photo.jpg", "webp", 800);

      assertEquals(result, "/.veryfront/optimized-images/images/photo-800w.webp");
    });

    it("should handle paths without leading slash", () => {
      const result = getOptimizedPath("images/photo.jpg", "avif", 1200);

      assertEquals(result, "/.veryfront/optimized-imagesimages/photo-1200w.avif");
    });

    it("should preserve directory structure", () => {
      const result = getOptimizedPath("/assets/photos/hero.png", "jpeg", 640);

      assertEquals(result, "/.veryfront/optimized-images/assets/photos/hero-640w.jpeg");
    });

    it("should handle files with multiple dots", () => {
      const result = getOptimizedPath("/images/photo.min.jpg", "webp", 1024);

      assertEquals(result, "/.veryfront/optimized-images/images/photo.min-1024w.webp");
    });

    it("should ignore quality parameter", () => {
      const result1 = getOptimizedPath("/image.jpg", "webp", 800, 80);
      const result2 = getOptimizedPath("/image.jpg", "webp", 800, 90);

      assertEquals(result1, result2);
    });
  });

  describe("generateSrcSet", () => {
    it("should generate srcset string for multiple sizes", () => {
      const result = generateSrcSet("/image.jpg", "webp", [640, 1024, 1920], 80);

      assertEquals(
        result,
        "/.veryfront/optimized-images/image-640w.webp 640w, /.veryfront/optimized-images/image-1024w.webp 1024w, /.veryfront/optimized-images/image-1920w.webp 1920w",
      );
    });

    it("should handle single size", () => {
      const result = generateSrcSet("/image.jpg", "avif", [800], 90);

      assertEquals(result, "/.veryfront/optimized-images/image-800w.avif 800w");
    });

    it("should work with different formats", () => {
      const result = generateSrcSet("/photo.png", "jpeg", [640, 1280], 75);

      assertEquals(
        result,
        "/.veryfront/optimized-images/photo-640w.jpeg 640w, /.veryfront/optimized-images/photo-1280w.jpeg 1280w",
      );
    });

    it("should handle empty sizes array", () => {
      const result = generateSrcSet("/image.jpg", "webp", [], 80);

      assertEquals(result, "");
    });

    it("should preserve order of sizes", () => {
      const sizes = [320, 640, 1024, 1920];
      const result = generateSrcSet("/image.jpg", "webp", sizes, 80);

      const parts = result.split(", ");
      assertEquals(parts.length, sizes.length);

      for (let i = 0; i < sizes.length; i++) {
        assertEquals(parts[i]!.includes(`-${sizes[i]}w.webp`), true);
        assertEquals(parts[i]!.includes(`${sizes[i]}w`), true);
      }
    });
  });

  describe("getExtension", () => {
    it("should extract extension from filename", () => {
      assertEquals(getExtension("photo.jpg"), "jpg");
      assertEquals(getExtension("image.png"), "png");
      assertEquals(getExtension("graphic.svg"), "svg");
    });

    it("should handle uppercase extensions", () => {
      assertEquals(getExtension("photo.JPG"), "jpg");
      assertEquals(getExtension("image.PNG"), "png");
    });

    it("should handle files with multiple dots", () => {
      assertEquals(getExtension("photo.min.jpg"), "jpg");
      assertEquals(getExtension("file.backup.png"), "png");
    });

    it("should return jpeg as default for no extension", () => {
      assertEquals(getExtension("noextension"), "jpeg");
      assertEquals(getExtension("file"), "jpeg");
    });

    it("should handle paths with directories", () => {
      assertEquals(getExtension("/images/photo.jpg"), "jpg");
      assertEquals(getExtension("assets/images/hero.png"), "png");
    });

    it("should handle edge cases", () => {
      assertEquals(getExtension(".hidden"), "hidden");
      assertEquals(getExtension("file."), "jpeg");
      assertEquals(getExtension(""), "jpeg");
    });
  });
});
