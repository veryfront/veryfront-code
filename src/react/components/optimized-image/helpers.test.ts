import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { OptimizedImageMetadata } from "#veryfront/types";
import {
  assertImageQuality,
  generateSrcSet,
  getImageExtension,
  getImageMimeType,
  getOptimizedPath,
} from "./helpers.ts";

const metadata: OptimizedImageMetadata = {
  original: "images/photo.jpg",
  originalSize: 100,
  defaultFormat: "jpeg",
  aspectRatio: 4 / 3,
  engineIdentity: "test-engine@1",
  quality: 73,
  variants: [
    {
      format: "webp",
      size: 320,
      width: 320,
      height: 240,
      path: "images/photo-320w-q73.webp",
      fileSize: 10,
      quality: 73,
    },
    {
      format: "webp",
      size: 640,
      width: 640,
      height: 480,
      path: "images/photo-640w-q73.webp",
      fileSize: 20,
      quality: 73,
    },
    {
      format: "jpeg",
      size: 640,
      width: 640,
      height: 480,
      path: "images/photo-640w-q73.jpeg",
      fileSize: 30,
      quality: 73,
    },
  ],
};

describe("optimized-image helpers", () => {
  it("selects only paths present in the generated manifest", () => {
    assertEquals(
      getOptimizedPath("/images/photo.jpg", metadata, "webp", 400),
      "/_vf/assets/images/images/photo-640w-q73.webp",
    );
    assertEquals(
      getOptimizedPath("/images/photo.jpg", metadata, "webp", 900),
      "/_vf/assets/images/images/photo-640w-q73.webp",
    );
  });

  it("builds srcset from actual manifest widths", () => {
    assertEquals(
      generateSrcSet("/images/photo.jpg", metadata, "webp"),
      "/_vf/assets/images/images/photo-320w-q73.webp 320w, " +
        "/_vf/assets/images/images/photo-640w-q73.webp 640w",
    );
  });

  it("fails when source, format, or quality was not produced", () => {
    assertThrows(
      () => getOptimizedPath("/images/other.jpg", metadata, "webp"),
      TypeError,
      "does not match",
    );
    assertThrows(
      () => getOptimizedPath("/images/photo.jpg", metadata, "avif"),
      TypeError,
      "no avif variant",
    );
    assertThrows(
      () => assertImageQuality(metadata, 80),
      TypeError,
      "manifest quality is 73",
    );
    assertThrows(
      () => getOptimizedPath("/images/photo.jpg", metadata, "webp", Number.NaN),
      TypeError,
      "width must be a positive finite number",
    );
  });

  it("normalizes jpg to the encoder's jpeg identifier and MIME type", () => {
    assertEquals(getImageExtension("/photo.jpg"), "jpeg");
    assertEquals(getImageExtension("/photo.jpeg"), "jpeg");
    assertEquals(getImageMimeType("jpeg"), "image/jpeg");
  });
});
