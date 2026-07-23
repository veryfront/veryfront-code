import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DEFAULT_OPTIONS,
  MANIFEST_FILENAME,
  SHARP_MODULE_SPECIFIER,
  SUPPORTED_EXTENSIONS,
} from "./constants.ts";

describe("build/asset-pipeline/image-optimizer/constants", () => {
  describe("DEFAULT_OPTIONS", () => {
    it("should have enabled set to true", () => {
      assertEquals(DEFAULT_OPTIONS.enabled, true);
    });

    it("should include webp, avif, and jpeg formats", () => {
      for (const format of ["webp", "avif", "jpeg"] as const) {
        assertEquals(DEFAULT_OPTIONS.formats.includes(format), true);
      }
    });

    it("should have non-empty sizes array", () => {
      assertEquals(Array.isArray(DEFAULT_OPTIONS.sizes), true);
      assertEquals(DEFAULT_OPTIONS.sizes.length > 0, true);
    });

    it("should have a positive quality value", () => {
      assertEquals(DEFAULT_OPTIONS.quality > 0, true);
      assertEquals(DEFAULT_OPTIONS.quality <= 100, true);
    });

    it("should have default input and output directories", () => {
      assertEquals(DEFAULT_OPTIONS.inputDir, "./public");
      assertEquals(DEFAULT_OPTIONS.outputDir, "./.veryfront/optimized-images");
      assertEquals(DEFAULT_OPTIONS.publicPath, "/.veryfront/optimized-images");
    });

    it("should not preserve originals by default", () => {
      assertEquals(DEFAULT_OPTIONS.preserveOriginal, false);
    });
  });

  describe("SUPPORTED_EXTENSIONS", () => {
    it("should include common image extensions", () => {
      for (const ext of [".jpg", ".jpeg", ".png", ".webp", ".avif"] as const) {
        assertEquals(SUPPORTED_EXTENSIONS.includes(ext), true);
      }
    });

    it("should have 5 supported extensions", () => {
      assertEquals(SUPPORTED_EXTENSIONS.length, 5);
    });
  });

  describe("SHARP_MODULE_SPECIFIER", () => {
    it("pins the supported Sharp package version", () => {
      assertEquals(SHARP_MODULE_SPECIFIER, "npm:sharp@0.34.5");
    });
  });

  describe("MANIFEST_FILENAME", () => {
    it("should be image-manifest.json", () => {
      assertEquals(MANIFEST_FILENAME, "image-manifest.json");
    });
  });
});
