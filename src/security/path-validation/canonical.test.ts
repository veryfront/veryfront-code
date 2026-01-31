import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getCanonicalPath, validateAllowedDirs } from "./canonical.ts";
import { PathValidationError } from "./types.ts";

describe("security/path-validation/canonical", () => {
  describe("getCanonicalPath", () => {
    it("should resolve path segments without adapter", async () => {
      const { path, isSymlink } = await getCanonicalPath("/a/b/../c");
      assertEquals(path, "/a/c");
      assertEquals(isSymlink, false);
    });

    it("should resolve dot segments", async () => {
      const { path, isSymlink } = await getCanonicalPath("/a/./b/./c");
      assertEquals(path, "/a/b/c");
      assertEquals(isSymlink, false);
    });

    it("should return isSymlink false when followSymlinks is false", async () => {
      const { isSymlink } = await getCanonicalPath("/some/path", undefined, false);
      assertEquals(isSymlink, false);
    });

    it("should return isSymlink false when adapter is undefined", async () => {
      const { isSymlink } = await getCanonicalPath("/some/path", undefined, true);
      assertEquals(isSymlink, false);
    });

    it("should use adapter.fs.stat when adapter and followSymlinks are provided", async () => {
      const mockAdapter: Parameters<typeof getCanonicalPath>[1] = {
        fs: {
          stat: (_path: string) =>
            Promise.resolve({
              isSymlink: true,
              isDirectory: false,
              isFile: true,
              size: 0,
            }),
        },
      };

      const { isSymlink } = await getCanonicalPath("/some/path", mockAdapter, true);
      assertEquals(isSymlink, true);
    });

    it("should fall back gracefully when adapter.fs.stat throws", async () => {
      const mockAdapter: Parameters<typeof getCanonicalPath>[1] = {
        fs: {
          stat: () => Promise.reject(new Error("not found")),
        },
      };

      const { path, isSymlink } = await getCanonicalPath("/some/path", mockAdapter, true);
      assertEquals(path, "/some/path");
      assertEquals(isSymlink, false);
    });

    it("should handle relative paths", async () => {
      const { path } = await getCanonicalPath("a/b/../c");
      assertEquals(path, "a/c");
    });
  });

  describe("validateAllowedDirs", () => {
    it("should return valid when path is within base and no allowedDirs", () => {
      const { valid } = validateAllowedDirs("/project/src/file.ts", "/project", []);
      assertEquals(valid, true);
    });

    it("should return invalid when path is outside base directory", () => {
      const { valid, code } = validateAllowedDirs("/other/file.ts", "/project", []);
      assertEquals(valid, false);
      assertEquals(code, PathValidationError.OUTSIDE_BASE);
    });

    it("should return valid when path equals base directory", () => {
      const { valid } = validateAllowedDirs("/project", "/project", ["src"]);
      assertEquals(valid, true);
    });

    it("should return valid when top-level dir is in allowedDirs", () => {
      const { valid } = validateAllowedDirs("/project/src/file.ts", "/project", ["src", "lib"]);
      assertEquals(valid, true);
    });

    it("should return invalid when top-level dir is not in allowedDirs", () => {
      const { valid, code } = validateAllowedDirs("/project/secret/file.ts", "/project", [
        "src",
        "lib",
      ]);
      assertEquals(valid, false);
      assertEquals(code, PathValidationError.NOT_IN_ALLOWLIST);
    });

    it("should handle paths with trailing slashes in base", () => {
      const { valid } = validateAllowedDirs("/project/src/file.ts", "/project/", ["src"]);
      assertEquals(valid, true);
    });

    it("should handle Windows-style separators", () => {
      const { valid } = validateAllowedDirs("/project/src/file.ts", "/project", ["src"]);
      assertEquals(valid, true);
    });

    it("should return invalid for sibling directories that share prefix", () => {
      const { valid, code } = validateAllowedDirs("/project-evil/file.ts", "/project", []);
      assertEquals(valid, false);
      assertEquals(code, PathValidationError.OUTSIDE_BASE);
    });

    it("should resolve dot-dot segments before validation", () => {
      const { valid } = validateAllowedDirs("/project/src/../lib/file.ts", "/project", ["lib"]);
      assertEquals(valid, true);
    });
  });
});
