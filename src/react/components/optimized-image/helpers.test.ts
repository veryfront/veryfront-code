import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateSrcSet, getImageExtension, getOptimizedPath } from "./helpers.ts";

describe("optimized-image helpers", () => {
  describe("getOptimizedPath", () => {
    it("generates path with size and format", () => {
      const path = getOptimizedPath("/images/photo.png", "webp", 640);
      assertEquals(path, "/.veryfront/optimized-images/images/photo-640w.webp");
    });

    it("strips original extension", () => {
      const path = getOptimizedPath("/hero.jpg", "avif", 1024);
      assertEquals(path, "/.veryfront/optimized-images/hero-1024w.avif");
    });

    it("handles nested paths", () => {
      const path = getOptimizedPath("/assets/blog/cover.jpeg", "webp", 320);
      assertEquals(path, "/.veryfront/optimized-images/assets/blog/cover-320w.webp");
    });
  });

  describe("generateSrcSet", () => {
    it("generates srcset string with multiple sizes", () => {
      const srcset = generateSrcSet("/photo.png", "webp", [320, 640, 1024], 80);
      const parts = srcset.split(", ");
      assertEquals(parts.length, 3);
      const first = parts[0];
      const second = parts[1];
      const third = parts[2];
      assertExists(first);
      assertExists(second);
      assertExists(third);
      assertEquals(first.endsWith("320w"), true);
      assertEquals(second.endsWith("640w"), true);
      assertEquals(third.endsWith("1024w"), true);
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
