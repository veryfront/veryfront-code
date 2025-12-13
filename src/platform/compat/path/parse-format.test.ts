import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { parse, format } from "./parse-format.ts";

describe("platform/compat/path/parse-format", () => {
  describe("parse", () => {
    it("should parse absolute path", () => {
      const result = parse("/path/to/file.txt");

      assertEquals(result.root, "/");
      assertEquals(result.dir, "/path/to");
      assertEquals(result.base, "file.txt");
      assertEquals(result.name, "file");
      assertEquals(result.ext, ".txt");
    });

    it("should parse relative path", () => {
      const result = parse("path/to/file.txt");

      assertEquals(result.root, "");
      assertEquals(result.dir, "path/to");
      assertEquals(result.base, "file.txt");
      assertEquals(result.name, "file");
      assertEquals(result.ext, ".txt");
    });

    it("should parse filename only", () => {
      const result = parse("file.txt");

      assertEquals(result.root, "");
      assertEquals(result.dir, ".");
      assertEquals(result.base, "file.txt");
      assertEquals(result.name, "file");
      assertEquals(result.ext, ".txt");
    });

    it("should parse path without extension", () => {
      const result = parse("/path/to/file");

      assertEquals(result.root, "/");
      assertEquals(result.dir, "/path/to");
      assertEquals(result.base, "file");
      assertEquals(result.name, "file");
      assertEquals(result.ext, "");
    });

    it("should handle multiple extensions", () => {
      const result = parse("file.min.js");

      assertEquals(result.base, "file.min.js");
      assertEquals(result.name, "file.min");
      assertEquals(result.ext, ".js");
    });

    it("should handle hidden files", () => {
      const result = parse(".gitignore");

      assertEquals(result.base, ".gitignore");
      assertEquals(result.name, ".gitignore");
      assertEquals(result.ext, "");
    });

    it("should handle root directory", () => {
      const result = parse("/");

      assertEquals(result.root, "/");
      assertEquals(result.dir, "/");
    });
  });

  describe("format", () => {
    it("should format with dir and base", () => {
      const result = format({
        root: "/",
        dir: "/path/to",
        base: "file.txt",
        name: "file",
        ext: ".txt",
      });

      assertEquals(result, "/path/to/file.txt");
    });

    it("should format with dir, name, and ext", () => {
      const result = format({
        dir: "/path/to",
        name: "file",
        ext: ".txt",
      });

      assertEquals(result, "/path/to/file.txt");
    });

    it("should prioritize base over name and ext", () => {
      const result = format({
        dir: "/path",
        base: "file.txt",
        name: "other",
        ext: ".js",
      });

      assertEquals(result, "/path/file.txt");
    });

    it("should handle name and ext without dir", () => {
      const result = format({
        name: "file",
        ext: ".txt",
      });

      assertEquals(result, "file.txt");
    });

    it("should handle base without dir", () => {
      const result = format({
        base: "file.txt",
      });

      assertEquals(result, "file.txt");
    });

    it("should handle empty pathObject", () => {
      const result = format({});

      assertEquals(result, "");
    });

    it("should handle only dir", () => {
      const result = format({
        dir: "/path/to",
      });

      assertEquals(result, "/path/to");
    });

    it("should format without extension", () => {
      const result = format({
        dir: "/path",
        name: "file",
        ext: "",
      });

      assertEquals(result, "/path/file");
    });

    it("should combine dir and name correctly", () => {
      const result = format({
        dir: "a/b/c",
        name: "test",
        ext: ".js",
      });

      assertEquals(result, "a/b/c/test.js");
    });
  });

  describe("parse and format round-trip", () => {
    it("should be reversible for absolute paths", () => {
      const path = "/path/to/file.txt";
      const parsed = parse(path);
      const formatted = format(parsed);

      assertEquals(formatted, path);
    });

    it("should be reversible for relative paths", () => {
      const path = "path/to/file.txt";
      const parsed = parse(path);
      const formatted = format(parsed);

      assertEquals(formatted, path);
    });

    it("should handle filename parse and format", () => {
      const path = "file.txt";
      const parsed = parse(path);
      const formatted = format(parsed);

      // Note: parse sets dir to ".", but format with dir "." returns "./file.txt"
      // This is expected behavior - not strictly reversible for simple filenames
      assertEquals(formatted, "./file.txt");
    });
  });
});
