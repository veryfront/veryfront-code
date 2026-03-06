import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { basename, dirname, extname, join } from "./basic-operations.ts";

describe("platform/compat/path/basic-operations", () => {
  describe("join", () => {
    it("should join two segments", () => {
      assertEquals(join("a", "b"), "a/b");
    });

    it("should join multiple segments", () => {
      assertEquals(join("a", "b", "c"), "a/b/c");
    });

    it("should normalize double slashes", () => {
      assertEquals(join("a/", "/b"), "a/b");
    });

    it("should skip empty strings", () => {
      assertEquals(join("a", "", "b"), "a/b");
    });

    it("should return / for no valid segments", () => {
      assertEquals(join(""), "/");
    });
  });

  describe("dirname", () => {
    it("should return parent directory", () => {
      assertEquals(dirname("/home/user/file.ts"), "/home/user");
    });

    it("should return / for root files", () => {
      assertEquals(dirname("/file.ts"), "/");
    });

    it("should return . for files without directory", () => {
      assertEquals(dirname("file.ts"), ".");
    });

    it("should handle Windows backslash paths", () => {
      assertEquals(dirname("D:\\a\\project\\src\\file.ts"), "D:/a/project/src");
    });
  });

  describe("basename", () => {
    it("should return filename", () => {
      assertEquals(basename("/home/user/file.ts"), "file.ts");
    });

    it("should strip extension when provided", () => {
      assertEquals(basename("/home/user/file.ts", ".ts"), "file");
    });

    it("should handle filename without directory", () => {
      assertEquals(basename("file.ts"), "file.ts");
    });

    it("should strip trailing slashes", () => {
      assertEquals(basename("/home/user/"), "user");
    });
  });

  describe("extname", () => {
    it("should return extension", () => {
      assertEquals(extname("file.ts"), ".ts");
    });

    it("should return extension from full path", () => {
      assertEquals(extname("/home/user/file.tsx"), ".tsx");
    });

    it("should return empty for no extension", () => {
      assertEquals(extname("Makefile"), "");
    });

    it("should return empty for dotfiles", () => {
      assertEquals(extname(".gitignore"), "");
    });

    it("should return last extension for multiple dots", () => {
      assertEquals(extname("file.test.ts"), ".ts");
    });
  });
});
