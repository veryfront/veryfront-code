import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { join, dirname, basename, extname } from "./basic-operations.ts";

describe("platform/compat/path/basic-operations", () => {
  describe("join", () => {
    it("should join multiple paths", () => {
      assertEquals(join("a", "b", "c"), "a/b/c");
    });

    it("should handle single path", () => {
      assertEquals(join("path"), "path");
    });

    it("should handle empty path", () => {
      assertEquals(join(), "/");
    });

    it("should remove duplicate slashes", () => {
      assertEquals(join("a//b", "c"), "a/b/c");
    });

    it("should handle leading slashes", () => {
      assertEquals(join("/a", "b"), "/a/b");
    });

    it("should remove trailing slashes", () => {
      assertEquals(join("a/", "b/"), "a/b");
    });

    it("should filter out empty strings", () => {
      assertEquals(join("a", "", "b"), "a/b");
    });

    it("should handle complex paths", () => {
      assertEquals(join("/var", "log", "app.log"), "/var/log/app.log");
    });
  });

  describe("dirname", () => {
    it("should return directory name", () => {
      assertEquals(dirname("/path/to/file.txt"), "/path/to");
    });

    it("should return . for no directory", () => {
      assertEquals(dirname("file.txt"), ".");
    });

    it("should return / for root directory", () => {
      assertEquals(dirname("/file.txt"), "/");
    });

    it("should handle nested paths", () => {
      assertEquals(dirname("/a/b/c/d.txt"), "/a/b/c");
    });

    it("should handle single level path", () => {
      assertEquals(dirname("a/b"), "a");
    });

    it("should return / for root", () => {
      assertEquals(dirname("/"), "/");
    });
  });

  describe("basename", () => {
    it("should return base filename", () => {
      assertEquals(basename("/path/to/file.txt"), "file.txt");
    });

    it("should return filename without extension", () => {
      assertEquals(basename("/path/to/file.txt", ".txt"), "file");
    });

    it("should handle no directory", () => {
      assertEquals(basename("file.txt"), "file.txt");
    });

    it("should handle nested paths", () => {
      assertEquals(basename("/a/b/c/d.txt"), "d.txt");
    });

    it("should remove extension when provided", () => {
      assertEquals(basename("test.js", ".js"), "test");
    });

    it("should only remove matching extension", () => {
      assertEquals(basename("test.js", ".ts"), "test.js");
    });

    it("should handle paths without slashes", () => {
      assertEquals(basename("filename.txt"), "filename.txt");
    });

    it("should handle empty extension", () => {
      assertEquals(basename("file.txt", ""), "file.txt");
    });
  });

  describe("extname", () => {
    it("should return file extension", () => {
      assertEquals(extname("file.txt"), ".txt");
    });

    it("should return empty for no extension", () => {
      assertEquals(extname("file"), "");
    });

    it("should handle multiple dots", () => {
      assertEquals(extname("file.min.js"), ".js");
    });

    it("should handle hidden files", () => {
      assertEquals(extname(".gitignore"), "");
    });

    it("should handle hidden files with extension", () => {
      assertEquals(extname(".env.local"), ".local");
    });

    it("should handle paths with directories", () => {
      assertEquals(extname("/path/to/file.txt"), ".txt");
    });

    it("should return empty for directories without extension", () => {
      assertEquals(extname("/path/to/dir"), "");
    });
  });
});
