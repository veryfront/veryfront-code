import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { CACHE_DURATIONS, CONTENT_TYPES } from "./constants.ts";

describe("Response Constants", () => {
  describe("CONTENT_TYPES", () => {
    it("should have JSON content type", () => {
      assertEquals(CONTENT_TYPES.JSON, "application/json; charset=utf-8");
    });

    it("should have HTML content type", () => {
      assertEquals(CONTENT_TYPES.HTML, "text/html; charset=utf-8");
    });

    it("should have TEXT content type", () => {
      assertEquals(CONTENT_TYPES.TEXT, "text/plain; charset=utf-8");
    });

    it("should have JAVASCRIPT content type", () => {
      assertEquals(CONTENT_TYPES.JAVASCRIPT, "application/javascript; charset=utf-8");
    });

    it("should have CSS content type", () => {
      assertEquals(CONTENT_TYPES.CSS, "text/css; charset=utf-8");
    });

    it("should have XML content type", () => {
      assertEquals(CONTENT_TYPES.XML, "application/xml; charset=utf-8");
    });

    it("should include charset in all content types", () => {
      Object.values(CONTENT_TYPES).forEach((contentType) => {
        assertEquals(contentType.includes("charset=utf-8"), true);
      });
    });
  });

  describe("CACHE_DURATIONS", () => {
    it("should have SHORT duration", () => {
      assertEquals(CACHE_DURATIONS.SHORT, 60);
    });

    it("should have MEDIUM duration", () => {
      assertEquals(CACHE_DURATIONS.MEDIUM, 3600);
    });

    it("should have LONG duration", () => {
      assertEquals(CACHE_DURATIONS.LONG, 31536000);
    });

    it("should have increasing durations", () => {
      assertEquals(CACHE_DURATIONS.SHORT < CACHE_DURATIONS.MEDIUM, true);
      assertEquals(CACHE_DURATIONS.MEDIUM < CACHE_DURATIONS.LONG, true);
    });
  });

  describe("constants immutability", () => {
    it("should be read-only objects", () => {
      assertExists(CONTENT_TYPES);
      assertExists(CACHE_DURATIONS);
    });
  });
});
