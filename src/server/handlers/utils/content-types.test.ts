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
      assertEquals(getContentType(".html"), "text/html; charset=utf-8");
      assertEquals(getContentType(".js"), "application/javascript; charset=utf-8");
      assertEquals(getContentType(".css"), "text/css; charset=utf-8");
      assertEquals(getContentType(".json"), "application/json; charset=utf-8");
      assertEquals(getContentType(".png"), "image/png");
    });

    it("should be case-insensitive", () => {
      assertEquals(getContentType(".HTML"), "text/html; charset=utf-8");
      assertEquals(getContentType(".JS"), "application/javascript; charset=utf-8");
    });

    it("should return octet-stream for unknown extensions", () => {
      assertEquals(getContentType(".xyz"), "application/octet-stream");
      assertEquals(getContentType(".unknown"), "application/octet-stream");
    });

    it("should handle media types", () => {
      assertEquals(getContentType(".mp4"), "video/mp4");
      assertEquals(getContentType(".mp3"), "audio/mpeg");
      assertEquals(getContentType(".woff2"), "font/woff2");
    });
  });

  describe("getContentTypeForPath", () => {
    it("should extract extension from path", () => {
      assertEquals(getContentTypeForPath("/assets/style.css"), "text/css; charset=utf-8");
      assertEquals(
        getContentTypeForPath("/scripts/app.js"),
        "application/javascript; charset=utf-8",
      );
    });

    it("should return octet-stream for no extension", () => {
      assertEquals(getContentTypeForPath("/no-extension"), "application/octet-stream");
    });

    it("should handle nested paths", () => {
      assertEquals(
        getContentTypeForPath("/a/b/c/d.json"),
        "application/json; charset=utf-8",
      );
    });
  });

  describe("isCompressible", () => {
    it("should return true for text types", () => {
      assertEquals(isCompressible("text/html"), true);
      assertEquals(isCompressible("text/css"), true);
      assertEquals(isCompressible("text/plain"), true);
    });

    it("should return true for javascript/json/xml/svg", () => {
      assertEquals(isCompressible("application/javascript"), true);
      assertEquals(isCompressible("application/json"), true);
      assertEquals(isCompressible("application/xml"), true);
      assertEquals(isCompressible("image/svg+xml"), true);
    });

    it("should return false for already compressed types", () => {
      assertEquals(isCompressible("image/jpeg"), false);
      assertEquals(isCompressible("image/png"), false);
      assertEquals(isCompressible("application/gzip"), false);
      assertEquals(isCompressible("application/zip"), false);
    });

    it("should return false for unknown types", () => {
      assertEquals(isCompressible("application/octet-stream"), false);
    });
  });

  describe("isCacheable", () => {
    it("should return true for images and fonts", () => {
      assertEquals(isCacheable("image/png"), true);
      assertEquals(isCacheable("image/jpeg"), true);
      assertEquals(isCacheable("font/woff2"), true);
    });

    it("should return true for JS and CSS", () => {
      assertEquals(isCacheable("application/javascript"), true);
      assertEquals(isCacheable("text/css"), true);
    });

    it("should return false for HTML and JSON", () => {
      assertEquals(isCacheable("text/html"), false);
      assertEquals(isCacheable("application/json"), false);
    });

    it("should return false for unknown types", () => {
      assertEquals(isCacheable("application/octet-stream"), false);
    });
  });
});
