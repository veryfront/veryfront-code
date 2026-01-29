import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isAbsolutePath,
  isWithinDirectory,
  joinPaths,
  normalizeSeparators,
  resolvePathSegments,
} from "./normalization.ts";

describe("security/path-validation/normalization", () => {
  describe("normalizeSeparators", () => {
    it("should replace backslashes with forward slashes", () => {
      assertEquals(normalizeSeparators("a\\b\\c"), "a/b/c");
    });

    it("should collapse multiple backslashes", () => {
      assertEquals(normalizeSeparators("a\\\\b"), "a/b");
    });

    it("should leave forward slashes unchanged", () => {
      assertEquals(normalizeSeparators("a/b/c"), "a/b/c");
    });
  });

  describe("isAbsolutePath", () => {
    it("should detect Unix absolute paths", () => {
      assertEquals(isAbsolutePath("/usr/local"), true);
    });

    it("should detect Windows drive paths", () => {
      assertEquals(isAbsolutePath("C:\\Users"), true);
      assertEquals(isAbsolutePath("D:/data"), true);
    });

    it("should detect UNC paths", () => {
      assertEquals(isAbsolutePath("\\\\server\\share"), true);
    });

    it("should return false for relative paths", () => {
      assertEquals(isAbsolutePath("./relative"), false);
      assertEquals(isAbsolutePath("relative"), false);
    });
  });

  describe("resolvePathSegments", () => {
    it("should resolve parent references", () => {
      assertEquals(resolvePathSegments("/a/b/../c"), "/a/c");
    });

    it("should resolve current directory references", () => {
      assertEquals(resolvePathSegments("/a/./b"), "/a/b");
    });

    it("should handle multiple parent references", () => {
      assertEquals(resolvePathSegments("/a/b/c/../../d"), "/a/d");
    });

    it("should not go above root", () => {
      assertEquals(resolvePathSegments("/a/../.."), "/");
    });

    it("should preserve leading slash for absolute paths", () => {
      assertEquals(resolvePathSegments("/a/b"), "/a/b");
    });

    it("should handle relative paths", () => {
      assertEquals(resolvePathSegments("a/b/../c"), "a/c");
    });
  });

  describe("joinPaths", () => {
    it("should join base and relative paths", () => {
      assertEquals(joinPaths("/usr/local", "bin"), "/usr/local/bin");
    });

    it("should handle trailing slash on base", () => {
      assertEquals(joinPaths("/usr/local/", "bin"), "/usr/local/bin");
    });

    it("should handle leading slash on relative", () => {
      assertEquals(joinPaths("/usr/local", "/bin"), "/usr/local/bin");
    });
  });

  describe("isWithinDirectory", () => {
    it("should return true for same directory", () => {
      assertEquals(isWithinDirectory("/project", "/project"), true);
    });

    it("should return true for subdirectory", () => {
      assertEquals(isWithinDirectory("/project", "/project/src/file.ts"), true);
    });

    it("should return false for parent directory", () => {
      assertEquals(isWithinDirectory("/project/src", "/project"), false);
    });

    it("should return false for sibling directory", () => {
      assertEquals(isWithinDirectory("/project-a", "/project-b"), false);
    });

    it("should handle trailing slashes", () => {
      assertEquals(isWithinDirectory("/project/", "/project/src"), true);
    });
  });
});
