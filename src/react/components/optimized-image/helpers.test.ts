import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateSrcSet, getImageExtension, getOptimizedPath } from "./helpers.ts";

describe("optimized-image helpers", () => {
  describe("getOptimizedPath", () => {
    it("generates path with size and format", () => {
      assertEquals(
        getOptimizedPath("/images/photo.png", "webp", 640),
        "/.veryfront/optimized-images/images/photo-640w.webp",
      );
    });

    it("strips original extension", () => {
      assertEquals(
        getOptimizedPath("/hero.jpg", "avif", 1024),
        "/.veryfront/optimized-images/hero-1024w.avif",
      );
    });

    it("handles nested paths", () => {
      assertEquals(
        getOptimizedPath("/assets/blog/cover.jpeg", "webp", 320),
        "/.veryfront/optimized-images/assets/blog/cover-320w.webp",
      );
    });
  });

  describe("generateSrcSet", () => {
    it("generates srcset string with multiple sizes", () => {
      const parts = generateSrcSet("/photo.png", "webp", [320, 640, 1024], 80).split(", ");
      assertEquals(parts.length, 3);

      parts.forEach((part) => assertExists(part));
      assertEquals(parts[0].endsWith("320w"), true);
      assertEquals(parts[1].endsWith("640w"), true);
      assertEquals(parts[2].endsWith("1024w"), true);
    });

    it("generates single-size srcset", () => {
      const srcset = generateSrcSet("/photo.png", "webp", [640], 80);
      assertEquals(srcset.includes("640w"), true);
      assertEquals(srcset.includes(","), false);
    });
  });

  describe("getImageExtension", () => {
    it("returns extension for known image types", () => {
      assertEquals(getImageExtension("/photo.png"), "png");
      assertEquals(getImageExtension("/photo.jpg"), "jpg");
      assertEquals(getImageExtension("/photo.webp"), "webp");
    });

    it("returns jpeg for paths without extension", () => {
      assertEquals(getImageExtension("/photo"), "jpeg");
    });

    it("handles nested paths", () => {
      assertEquals(getImageExtension("/images/blog/hero.avif"), "avif");
    });
  });
});
