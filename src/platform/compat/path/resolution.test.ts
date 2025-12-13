import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import { resolve, isAbsolute, relative, normalize } from "./resolution.ts";

describe("platform/compat/path/resolution", () => {
  describe("isAbsolute", () => {
    it("should return true for absolute paths", () => {
      assertEquals(isAbsolute("/path/to/file"), true);
      assertEquals(isAbsolute("/"), true);
      assertEquals(isAbsolute("/a"), true);
    });

    it("should return false for relative paths", () => {
      assertEquals(isAbsolute("path/to/file"), false);
      assertEquals(isAbsolute("./file"), false);
      assertEquals(isAbsolute("../file"), false);
      assertEquals(isAbsolute("file"), false);
    });
  });

  describe("resolve", () => {
    it("should resolve absolute path", () => {
      const result = resolve("/path/to/file");
      // resolve prepends CWD for relative paths, but keeps absolute paths
      assert(result.endsWith("/path/to/file"));
    });

    it("should resolve multiple paths", () => {
      const result = resolve("/path", "to", "file");
      assert(result.includes("path"));
      assert(result.includes("to"));
      assert(result.includes("file"));
    });

    it("should handle parent directory", () => {
      const result = resolve("/path/to/../file");
      assert(result.endsWith("/path/file"));
    });

    it("should handle current directory", () => {
      const result = resolve("/path/./to/file");
      assert(result.endsWith("/path/to/file"));
    });

    it("should handle empty segments", () => {
      const result = resolve("/path//to/file");
      assert(result.includes("/path") && result.includes("/to"));
    });
  });

  describe("relative", () => {
    it("should find relative path between two paths", () => {
      const result = relative("/path/to/a", "/path/to/b");
      assertEquals(result, "../b");
    });

    it("should return . for same path", () => {
      const result = relative("/path/to/file", "/path/to/file");
      assertEquals(result, ".");
    });

    it("should handle nested paths", () => {
      const result = relative("/a/b/c", "/a/d/e");
      assertEquals(result, "../../d/e");
    });

    it("should handle going deeper", () => {
      const result = relative("/a", "/a/b/c");
      assertEquals(result, "b/c");
    });

    it("should handle going up", () => {
      const result = relative("/a/b/c", "/a");
      assertEquals(result, "../..");
    });
  });

  describe("normalize", () => {
    it("should normalize simple path", () => {
      const result = normalize("/path/to/file");
      assertEquals(result, "/path/to/file");
    });

    it("should handle empty string", () => {
      const result = normalize("");
      assertEquals(result, ".");
    });

    it("should remove . segments", () => {
      const result = normalize("/path/./to/./file");
      assertEquals(result, "/path/to/file");
    });

    it("should handle .. segments", () => {
      const result = normalize("/path/to/../file");
      assertEquals(result, "/path/file");
    });

    it("should handle multiple .. segments", () => {
      const result = normalize("/path/to/a/../../file");
      assertEquals(result, "/path/file");
    });

    it("should handle relative paths", () => {
      const result = normalize("path/to/file");
      assertEquals(result, "path/to/file");
    });

    it("should handle relative with ..", () => {
      const result = normalize("path/to/../file");
      assertEquals(result, "path/file");
    });

    it("should handle .. at start of relative path", () => {
      const result = normalize("../path/to/file");
      assertEquals(result, "../path/to/file");
    });

    it("should handle root path", () => {
      const result = normalize("/");
      assertEquals(result, "/");
    });

    it("should not go above root for absolute paths", () => {
      const result = normalize("/path/../../file");
      assertEquals(result, "/file");
    });
  });
});
