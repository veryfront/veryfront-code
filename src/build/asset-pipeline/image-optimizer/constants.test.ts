import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import {
  DEFAULT_OPTIONS,
  SUPPORTED_EXTENSIONS,
  SHARP_CDN_URL,
  MANIFEST_FILENAME,
} from "./constants.ts";

describe("constants", () => {
  describe("DEFAULT_OPTIONS", () => {
    it("should have correct default values", () => {
      assertExists(DEFAULT_OPTIONS);
      assertEquals(DEFAULT_OPTIONS.enabled, true);
      assertEquals(Array.isArray(DEFAULT_OPTIONS.formats), true);
      assertEquals(DEFAULT_OPTIONS.formats.includes("webp"), true);
      assertEquals(DEFAULT_OPTIONS.preserveOriginal, false);
    });

    it("should include common image formats", () => {
      assertEquals(DEFAULT_OPTIONS.formats.includes("webp"), true);
      assertEquals(DEFAULT_OPTIONS.formats.includes("avif"), true);
      assertEquals(DEFAULT_OPTIONS.formats.includes("jpeg"), true);
    });

    it("should have defined sizes array", () => {
      assertExists(DEFAULT_OPTIONS.sizes);
      assertEquals(Array.isArray(DEFAULT_OPTIONS.sizes), true);
      assertEquals(DEFAULT_OPTIONS.sizes.length > 0, true);
    });

    it("should have valid directory paths", () => {
      assertEquals(typeof DEFAULT_OPTIONS.inputDir, "string");
      assertEquals(typeof DEFAULT_OPTIONS.outputDir, "string");
      assertEquals(DEFAULT_OPTIONS.inputDir.length > 0, true);
      assertEquals(DEFAULT_OPTIONS.outputDir.length > 0, true);
    });

    it("should have quality setting", () => {
      assertEquals(typeof DEFAULT_OPTIONS.quality, "number");
      assertEquals(DEFAULT_OPTIONS.quality > 0, true);
      assertEquals(DEFAULT_OPTIONS.quality <= 100, true);
    });
  });

  describe("SUPPORTED_EXTENSIONS", () => {
    it("should be an array", () => {
      assertExists(SUPPORTED_EXTENSIONS);
      assertEquals(Array.isArray(SUPPORTED_EXTENSIONS), true);
    });

    it("should include common image extensions", () => {
      assertEquals(SUPPORTED_EXTENSIONS.includes(".jpg"), true);
      assertEquals(SUPPORTED_EXTENSIONS.includes(".jpeg"), true);
      assertEquals(SUPPORTED_EXTENSIONS.includes(".png"), true);
      assertEquals(SUPPORTED_EXTENSIONS.includes(".webp"), true);
    });

    it("should have extensions starting with dot", () => {
      SUPPORTED_EXTENSIONS.forEach((ext) => {
        assertEquals(ext.startsWith("."), true);
      });
    });
  });

  describe("SHARP_CDN_URL", () => {
    it("should be a valid URL string", () => {
      assertEquals(typeof SHARP_CDN_URL, "string");
      assertEquals(SHARP_CDN_URL.startsWith("https://"), true);
    });

    it("should point to sharp package", () => {
      assertEquals(SHARP_CDN_URL.includes("sharp"), true);
    });
  });

  describe("MANIFEST_FILENAME", () => {
    it("should be a valid filename", () => {
      assertEquals(typeof MANIFEST_FILENAME, "string");
      assertEquals(MANIFEST_FILENAME.endsWith(".json"), true);
    });

    it("should have correct name", () => {
      assertEquals(MANIFEST_FILENAME, "image-manifest.json");
    });
  });
});
