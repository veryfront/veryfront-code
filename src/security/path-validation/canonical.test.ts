import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getCanonicalPath, validateAllowedDirs } from "./canonical.ts";
import { PathValidationError } from "./types.ts";

describe("security/path-validation/canonical", () => {
  describe("getCanonicalPath", () => {
    it("should resolve path segments without adapter", async () => {
      const result = await getCanonicalPath("/a/b/../c");
      assertEquals(result.path, "/a/c");
      assertEquals(result.isSymlink, false);
    });

    it("should resolve dot segments", async () => {
      const result = await getCanonicalPath("/a/./b/./c");
      assertEquals(result.path, "/a/b/c");
      assertEquals(result.isSymlink, false);
    });

    it("should return isSymlink false when followSymlinks is false", async () => {
      const result = await getCanonicalPath("/some/path", undefined, false);
      assertEquals(result.isSymlink, false);
    });

    it("should return isSymlink false when adapter is undefined", async () => {
      const result = await getCanonicalPath("/some/path", undefined, true);
      assertEquals(result.isSymlink, false);
    });

    it("should use adapter.fs.stat when adapter and followSymlinks are provided", async () => {
      const mockAdapter = {
        fs: {
          stat: (_path: string) =>
            Promise.resolve({ isSymlink: true, isDirectory: false, isFile: true, size: 0 }),
        },
      } as unknown as Parameters<typeof getCanonicalPath>[1];

      const result = await getCanonicalPath("/some/path", mockAdapter, true);
      assertEquals(result.isSymlink, true);
    });

    it("should fall back gracefully when adapter.fs.stat throws", async () => {
      const mockAdapter = {
        fs: {
          stat: () => Promise.reject(new Error("not found")),
        },
      } as unknown as Parameters<typeof getCanonicalPath>[1];

      const result = await getCanonicalPath("/some/path", mockAdapter, true);
      assertEquals(result.path, "/some/path");
      assertEquals(result.isSymlink, false);
    });

    it("should handle relative paths", async () => {
      const result = await getCanonicalPath("a/b/../c");
      assertEquals(result.path, "a/c");
    });
  });

  describe("validateAllowedDirs", () => {
    it("should return valid when path is within base and no allowedDirs", () => {
      const result = validateAllowedDirs("/project/src/file.ts", "/project", []);
      assertEquals(result.valid, true);
    });

    it("should return invalid when path is outside base directory", () => {
      const result = validateAllowedDirs("/other/file.ts", "/project", []);
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.OUTSIDE_BASE);
    });

    it("should return valid when path equals base directory", () => {
      const result = validateAllowedDirs("/project", "/project", ["src"]);
      assertEquals(result.valid, true);
    });

    it("should return valid when top-level dir is in allowedDirs", () => {
      const result = validateAllowedDirs("/project/src/file.ts", "/project", ["src", "lib"]);
      assertEquals(result.valid, true);
    });

    it("should return invalid when top-level dir is not in allowedDirs", () => {
      const result = validateAllowedDirs("/project/secret/file.ts", "/project", ["src", "lib"]);
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.NOT_IN_ALLOWLIST);
    });

    it("should handle paths with trailing slashes in base", () => {
      const result = validateAllowedDirs("/project/src/file.ts", "/project/", ["src"]);
      assertEquals(result.valid, true);
    });

    it("should handle Windows-style separators", () => {
      const result = validateAllowedDirs("/project/src/file.ts", "/project", ["src"]);
      assertEquals(result.valid, true);
    });

    it("should return invalid for sibling directories that share prefix", () => {
      const result = validateAllowedDirs("/project-evil/file.ts", "/project", []);
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.OUTSIDE_BASE);
    });

    it("should resolve dot-dot segments before validation", () => {
      const result = validateAllowedDirs("/project/src/../lib/file.ts", "/project", ["lib"]);
      assertEquals(result.valid, true);
    });
  });
});
