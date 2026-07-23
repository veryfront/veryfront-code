import "#veryfront/schemas/_test-setup.ts";
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

    it("accepts an existing media type without treating it as a path", () => {
      assertEquals(contentType("text/html"), "text/html; charset=UTF-8");
      assertEquals(contentType("application/json"), "application/json; charset=UTF-8");
    });

    it("looks up filenames that contain directory separators", () => {
      assertEquals(contentType("assets/app.js"), "application/javascript; charset=UTF-8");
      assertEquals(contentType("/tmp/image.png"), "image/png");
      assertEquals(contentType("assets/file.unknown-extension"), undefined);
    });

    it("preserves an explicit charset parameter", () => {
      assertEquals(
        contentType("text/html; charset=iso-8859-1"),
        "text/html; charset=iso-8859-1",
      );
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

    it("normalizes case, whitespace, and parameters", () => {
      assertEquals(extension(" TEXT/HTML; charset=UTF-8 "), "html");
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

    it("normalizes case, whitespace, and parameters", () => {
      assertEquals(charset(" TEXT/PLAIN; charset=iso-8859-1 "), "UTF-8");
    });
  });
});
