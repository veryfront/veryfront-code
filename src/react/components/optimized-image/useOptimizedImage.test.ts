import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { useOptimizedImage } from "./useOptimizedImage.ts";

describe("useOptimizedImage", () => {
  it("should return sources and fallback", () => {
    const result = useOptimizedImage("/images/hero.jpg");

    assertExists(result.sources);
    assertExists(result.fallback);
    assertEquals(Array.isArray(result.sources), true);
    assertEquals(typeof result.fallback, "string");
  });

  it("should generate sources for default formats", () => {
    const result = useOptimizedImage("/images/hero.jpg");

    assertEquals(result.sources.length, 3);
    assertEquals(result.sources[0]!.format, "avif");
    assertEquals(result.sources[1]!.format, "webp");
    assertEquals(result.sources[2]!.format, "jpeg");
  });

  it("should generate srcSet for each format", () => {
    const result = useOptimizedImage("/images/hero.jpg");

    for (const source of result.sources) {
      assertEquals(typeof source.srcSet, "string");
      assertEquals(source.srcSet.length > 0, true);
      assertEquals(source.srcSet.includes("w"), true);
    }
  });

  it("should set correct MIME types", () => {
    const result = useOptimizedImage("/images/hero.jpg");

    assertEquals(result.sources[0]!.type, "image/avif");
    assertEquals(result.sources[1]!.type, "image/webp");
    assertEquals(result.sources[2]!.type, "image/jpeg");
  });

  it("should use custom formats when provided", () => {
    const result = useOptimizedImage("/images/hero.jpg", {
      formats: ["webp", "jpeg"],
    });

    assertEquals(result.sources.length, 2);
    assertEquals(result.sources[0]!.format, "webp");
    assertEquals(result.sources[1]!.format, "jpeg");
  });

  it("should support PNG format", () => {
    const result = useOptimizedImage("/images/icon.png", {
      formats: ["png", "webp"],
    });

    assertEquals(result.sources.length, 2);
    assertEquals(result.sources[0]!.format, "png");
    assertEquals(result.sources[0]!.type, "image/png");
  });

  it("should use custom quality when provided", () => {
    const result = useOptimizedImage("/images/hero.jpg", {
      quality: 90,
    });

    assertExists(result.sources);
    assertEquals(Array.isArray(result.sources), true);
  });

  it("should use default quality of 80", () => {
    const result = useOptimizedImage("/images/hero.jpg");

    assertExists(result.sources);
    assertEquals(Array.isArray(result.sources), true);
  });

  it("should generate fallback with correct extension", () => {
    const result1 = useOptimizedImage("/images/hero.jpg");
    assertEquals(result1.fallback.includes(".jpg"), true);

    const result2 = useOptimizedImage("/images/photo.png");
    assertEquals(result2.fallback.includes(".png"), true);
  });

  it("should generate fallback at large size", () => {
    const result = useOptimizedImage("/images/hero.jpg");

    assertEquals(result.fallback.includes("-1920w"), true);
  });

  it("should handle paths with directories", () => {
    const result = useOptimizedImage("/assets/images/hero.jpg");

    assertEquals(result.fallback.includes("/assets/images/hero"), true);
    for (const source of result.sources) {
      assertEquals(source.srcSet.includes("/assets/images/hero"), true);
    }
  });

  it("should work with minimal path", () => {
    const result = useOptimizedImage("hero.jpg");

    assertExists(result.sources);
    assertExists(result.fallback);
    assertEquals(result.sources.length > 0, true);
  });

  it("should handle empty options", () => {
    const result = useOptimizedImage("/images/hero.jpg", {});

    assertEquals(result.sources.length, 3);
    assertExists(result.fallback);
  });

  it("should include multiple widths in srcSet", () => {
    const result = useOptimizedImage("/images/hero.jpg");

    for (const source of result.sources) {
      const widthMatches = source.srcSet.match(/\d+w/g);
      assertExists(widthMatches);
      assertEquals(widthMatches.length > 1, true);
    }
  });

  it("should generate unique paths for each format", () => {
    const result = useOptimizedImage("/images/hero.jpg");

    const avifSrc = result.sources[0]!.srcSet;
    const webpSrc = result.sources[1]!.srcSet;
    const jpegSrc = result.sources[2]!.srcSet;

    assertEquals(avifSrc.includes(".avif"), true);
    assertEquals(webpSrc.includes(".webp"), true);
    assertEquals(jpegSrc.includes(".jpeg"), true);
  });
});
