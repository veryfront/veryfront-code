import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getContentType,
  getContentTypeForPath,
  isCacheable,
  isCompressible,
} from "./content-types.ts";

describe("server/handlers/utils/content-types", () => {
  describe("getContentType", () => {
    it("should return content type for known extensions", () => {
      const cases: Array<[string, string]> = [
        [".html", "text/html; charset=utf-8"],
        [".js", "application/javascript; charset=utf-8"],
        [".css", "text/css; charset=utf-8"],
        [".json", "application/json; charset=utf-8"],
        [".png", "image/png"],
      ];

      for (const [ext, expected] of cases) {
        assertEquals(getContentType(ext), expected);
      }
    });

    it("should be case-insensitive", () => {
      const cases: Array<[string, string]> = [
        [".HTML", "text/html; charset=utf-8"],
        [".JS", "application/javascript; charset=utf-8"],
      ];

      for (const [ext, expected] of cases) {
        assertEquals(getContentType(ext), expected);
      }
    });

    it("should return octet-stream for unknown extensions", () => {
      const cases: Array<[string, string]> = [
        [".xyz", "application/octet-stream"],
        [".unknown", "application/octet-stream"],
      ];

      for (const [ext, expected] of cases) {
        assertEquals(getContentType(ext), expected);
      }
    });

    it("should handle media types", () => {
      const cases: Array<[string, string]> = [
        [".mp4", "video/mp4"],
        [".mp3", "audio/mpeg"],
        [".woff2", "font/woff2"],
      ];

      for (const [ext, expected] of cases) {
        assertEquals(getContentType(ext), expected);
      }
    });
  });

  describe("getContentTypeForPath", () => {
    it("should extract extension from path", () => {
      const cases: Array<[string, string]> = [
        ["/assets/style.css", "text/css; charset=utf-8"],
        ["/scripts/app.js", "application/javascript; charset=utf-8"],
      ];

      for (const [path, expected] of cases) {
        assertEquals(getContentTypeForPath(path), expected);
      }
    });

    it("should return octet-stream for no extension", () => {
      assertEquals(getContentTypeForPath("/no-extension"), "application/octet-stream");
    });

    it("should handle nested paths", () => {
      assertEquals(getContentTypeForPath("/a/b/c/d.json"), "application/json; charset=utf-8");
    });
  });

  describe("isCompressible", () => {
    it("should return true for text types", () => {
      const cases: Array<[string, boolean]> = [
        ["text/html", true],
        ["text/css", true],
        ["text/plain", true],
      ];

      for (const [type, expected] of cases) {
        assertEquals(isCompressible(type), expected);
      }
    });

    it("should return true for javascript/json/xml/svg", () => {
      const cases: Array<[string, boolean]> = [
        ["application/javascript", true],
        ["application/json", true],
        ["application/xml", true],
        ["image/svg+xml", true],
      ];

      for (const [type, expected] of cases) {
        assertEquals(isCompressible(type), expected);
      }
    });

    it("should return false for already compressed types", () => {
      const cases: Array<[string, boolean]> = [
        ["image/jpeg", false],
        ["image/png", false],
        ["application/gzip", false],
        ["application/zip", false],
      ];

      for (const [type, expected] of cases) {
        assertEquals(isCompressible(type), expected);
      }
    });

    it("should return false for unknown types", () => {
      assertEquals(isCompressible("application/octet-stream"), false);
    });
  });

  describe("isCacheable", () => {
    it("should return true for images and fonts", () => {
      const cases: Array<[string, boolean]> = [
        ["image/png", true],
        ["image/jpeg", true],
        ["font/woff2", true],
      ];

      for (const [type, expected] of cases) {
        assertEquals(isCacheable(type), expected);
      }
    });

    it("should return true for JS and CSS", () => {
      const cases: Array<[string, boolean]> = [
        ["application/javascript", true],
        ["text/css", true],
      ];

      for (const [type, expected] of cases) {
        assertEquals(isCacheable(type), expected);
      }
    });

    it("should return false for HTML and JSON", () => {
      const cases: Array<[string, boolean]> = [
        ["text/html", false],
        ["application/json", false],
      ];

      for (const [type, expected] of cases) {
        assertEquals(isCacheable(type), expected);
      }
    });

    it("should return false for unknown types", () => {
      assertEquals(isCacheable("application/octet-stream"), false);
    });
  });
});
