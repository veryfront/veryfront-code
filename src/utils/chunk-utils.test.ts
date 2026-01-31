import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeChunkPath } from "./chunk-utils.ts";

describe("chunk-utils", () => {
  describe("normalizeChunkPath", () => {
    const base = "/base";

    it("should return null for null input", () => {
      assertEquals(normalizeChunkPath(null, base), null);
    });

    it("should return null for undefined input", () => {
      assertEquals(normalizeChunkPath(undefined, base), null);
    });

    it("should return null for empty string", () => {
      assertEquals(normalizeChunkPath("", base), null);
    });

    it("should return null for http:// URLs", () => {
      assertEquals(normalizeChunkPath("http://example.com/chunk.js", base), null);
    });

    it("should return null for https:// URLs", () => {
      assertEquals(normalizeChunkPath("https://cdn.example.com/chunk.js", base), null);
    });

    it("should return absolute paths unchanged", () => {
      assertEquals(normalizeChunkPath("/absolute/path.js", base), "/absolute/path.js");
    });

    it("should strip leading ./ and prepend base", () => {
      assertEquals(normalizeChunkPath("./file.js", base), "/base/file.js");
    });

    it("should prepend / to _veryfront/ paths", () => {
      assertEquals(
        normalizeChunkPath("_veryfront/chunks/abc.js", base),
        "/_veryfront/chunks/abc.js",
      );
    });

    it("should prepend /_veryfront/ to chunks/ paths", () => {
      assertEquals(normalizeChunkPath("chunks/abc.js", base), "/_veryfront/chunks/abc.js");
    });

    it("should prepend base to relative paths", () => {
      assertEquals(normalizeChunkPath("file.js", base), "/base/file.js");
    });

    it("should handle nested relative paths", () => {
      assertEquals(normalizeChunkPath("nested/deep/file.js", base), "/base/nested/deep/file.js");
    });
  });
});
