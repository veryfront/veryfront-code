import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  INTERNAL_PREFIX,
  isInternalEndpoint,
  isStaticAsset,
  normalizeChunkPath,
} from "./server.ts";

describe("constants/server", () => {
  describe("isInternalEndpoint", () => {
    it("should return true for _veryfront paths", () => {
      assertEquals(isInternalEndpoint("/_veryfront/hmr.js"), true);
    });

    it("should return true for nested _veryfront paths", () => {
      assertEquals(isInternalEndpoint("/_veryfront/rsc/client.js"), true);
    });

    it("should return false for non-internal paths", () => {
      assertEquals(isInternalEndpoint("/about"), false);
    });

    it("should return false for partial match without trailing slash", () => {
      assertEquals(isInternalEndpoint("/_veryfront"), false);
    });

    it("should return false for similar prefixes", () => {
      assertEquals(isInternalEndpoint("/_veryfrontx/foo"), false);
    });
  });

  describe("isStaticAsset", () => {
    it("should return true for paths with extensions", () => {
      assertEquals(isStaticAsset("/styles/main.css"), true);
    });

    it("should return true for internal endpoints", () => {
      assertEquals(isStaticAsset("/_veryfront/client.js"), true);
    });

    it("should return false for extensionless non-internal paths", () => {
      assertEquals(isStaticAsset("/about"), false);
    });

    it("should return false for root path", () => {
      assertEquals(isStaticAsset("/"), false);
    });
  });

  describe("normalizeChunkPath", () => {
    it("should return absolute paths unchanged", () => {
      assertEquals(normalizeChunkPath("/absolute/path.js"), "/absolute/path.js");
    });

    it("should prepend default base path for relative filenames", () => {
      const result = normalizeChunkPath("chunk-abc.js");
      assertEquals(result, `${INTERNAL_PREFIX}/chunks/chunk-abc.js`);
    });

    it("should prepend custom base path", () => {
      assertEquals(normalizeChunkPath("file.js", "/custom/"), "/custom/file.js");
    });

    it("should handle base paths with trailing slash", () => {
      assertEquals(normalizeChunkPath("file.js", "/base/"), "/base/file.js");
    });
  });
});
