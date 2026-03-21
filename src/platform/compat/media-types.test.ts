import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { charset, contentType, extension, lookup } from "./media-types.ts";

describe("media types compat", () => {
  it("basics", () => {
    assertEquals(contentType("test.html")?.startsWith("text/html") ?? false, true);
    assertEquals(extension("text/css"), "css");
    assertEquals(typeof lookup(".js"), "string");
    assertEquals(typeof charset("text/html"), "string");
  });

  describe("contentType", () => {
    it("should return content type with charset for text files", () => {
      const result = contentType("file.html");
      assertEquals(result?.includes("text/html"), true);
      assertEquals(result?.includes("charset="), true);
    });

    it("should return undefined for unknown types", () => {
      assertEquals(contentType("file.xyz123"), undefined);
    });

    it("should handle CSS files", () => {
      const result = contentType("styles.css");
      assertEquals(result?.includes("text/css"), true);
    });

    it("should handle JSON files without charset", () => {
      const result = contentType("data.json");
      assertEquals(result?.includes("application/json"), true);
    });

    it("should handle image files without charset", () => {
      const result = contentType("image.png");
      assertEquals(result, "image/png");
    });
  });

  describe("extension", () => {
    it("should return extension for known types", () => {
      assertEquals(extension("text/html"), "html");
      assertEquals(extension("application/json"), "json");
    });

    it("should return falsy for unknown types", () => {
      assertEquals(!!extension("application/x-unknown-custom"), false);
    });
  });

  describe("lookup", () => {
    it("should return MIME type for known extensions", () => {
      assertEquals(lookup(".html"), "text/html");
      assertEquals(lookup(".css"), "text/css");
      assertEquals(lookup(".json"), "application/json");
    });

    it("should return falsy for unknown extensions", () => {
      assertEquals(!!lookup(".xyz123"), false);
    });

    it("should work with full filenames", () => {
      assertEquals(lookup("file.js")?.includes("javascript"), true);
    });
  });

  describe("charset", () => {
    it("should return UTF-8 for text types", () => {
      assertEquals(charset("text/html"), "UTF-8");
    });

    it("should return falsy for non-text types", () => {
      assertEquals(!!charset("image/png"), false);
    });
  });
});
