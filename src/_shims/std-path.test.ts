import { assertEquals, assert, assertExists } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import {
  fromFileUrl,
  toFileUrl,
  basename,
  dirname,
  extname,
  join,
  resolve,
  relative,
  isAbsolute,
  normalize,
  parse,
  format,
  sep,
  delimiter,
  SEPARATOR,
  SEPARATOR_PATTERN,
} from "./std-path.ts";

describe("std-path", () => {
  describe("fromFileUrl", () => {
    it("should convert file URL string to path", () => {
      const fileUrl = "file:///Users/test/file.txt";
      const result = fromFileUrl(fileUrl);

      assertExists(result);
      assert(result.includes("file.txt"));
    });

    it("should convert file URL object to path", () => {
      const fileUrl = new URL("file:///Users/test/file.txt");
      const result = fromFileUrl(fileUrl);

      assertExists(result);
      assert(result.includes("file.txt"));
    });

    it("should handle URL with spaces", () => {
      const fileUrl = "file:///Users/test%20folder/file.txt";
      const result = fromFileUrl(fileUrl);

      assertExists(result);
      assert(result.includes("test folder") || result.includes("test%20folder"));
    });

    it("should handle URL with special characters", () => {
      const fileUrl = "file:///Users/test/file%20(1).txt";
      const result = fromFileUrl(fileUrl);

      assertExists(result);
    });
  });

  describe("toFileUrl", () => {
    it("should convert absolute path to file URL", () => {
      const absolutePath = Deno.build.os === "windows"
        ? "C:\\Users\\test\\file.txt"
        : "/Users/test/file.txt";

      const result = toFileUrl(absolutePath);

      assertExists(result);
      assertEquals(result.protocol, "file:");
      assert(result.href.includes("file.txt"));
    });

    it("should handle path with spaces", () => {
      const pathWithSpaces = Deno.build.os === "windows"
        ? "C:\\Users\\test folder\\file.txt"
        : "/Users/test folder/file.txt";

      const result = toFileUrl(pathWithSpaces);

      assertExists(result);
      assertEquals(result.protocol, "file:");
    });
  });

  describe("basename", () => {
    it("should get basename from path", () => {
      const result = basename("/Users/test/file.txt");

      assertEquals(result, "file.txt");
    });

    it("should get basename without extension", () => {
      const result = basename("/Users/test/file.txt", ".txt");

      assertEquals(result, "file");
    });

    it("should handle path without directory", () => {
      const result = basename("file.txt");

      assertEquals(result, "file.txt");
    });

    it("should handle empty path", () => {
      const result = basename("");

      assertEquals(result, "");
    });

    it("should handle path ending with separator", () => {
      const result = basename("/Users/test/");

      assertEquals(result, "test");
    });
  });

  describe("dirname", () => {
    it("should get directory name from path", () => {
      const result = dirname("/Users/test/file.txt");

      assertEquals(result, "/Users/test");
    });

    it("should handle nested paths", () => {
      const result = dirname("/Users/test/nested/file.txt");

      assertEquals(result, "/Users/test/nested");
    });

    it("should handle root directory", () => {
      const result = dirname("/file.txt");

      assertEquals(result, "/");
    });

    it("should handle relative path", () => {
      const result = dirname("test/file.txt");

      assertEquals(result, "test");
    });

    it("should handle file without directory", () => {
      const result = dirname("file.txt");

      assertEquals(result, ".");
    });
  });

  describe("extname", () => {
    it("should get file extension", () => {
      const result = extname("file.txt");

      assertEquals(result, ".txt");
    });

    it("should handle multiple dots", () => {
      const result = extname("file.test.txt");

      assertEquals(result, ".txt");
    });

    it("should handle file without extension", () => {
      const result = extname("file");

      assertEquals(result, "");
    });

    it("should handle hidden files", () => {
      const result = extname(".gitignore");

      assertEquals(result, "");
    });

    it("should handle hidden files with extension", () => {
      const result = extname(".config.json");

      assertEquals(result, ".json");
    });

    it("should handle path with directory", () => {
      const result = extname("/Users/test/file.txt");

      assertEquals(result, ".txt");
    });
  });

  describe("join", () => {
    it("should join path segments", () => {
      const result = join("Users", "test", "file.txt");

      assert(result.includes("Users"));
      assert(result.includes("test"));
      assert(result.includes("file.txt"));
    });

    it("should handle absolute paths", () => {
      const result = join("/Users", "test", "file.txt");

      assert(result.startsWith("/") || result.match(/^[A-Z]:\\/));
    });

    it("should normalize multiple separators", () => {
      const result = join("Users//test///file.txt");

      assert(!result.includes("//"));
    });

    it("should handle empty segments", () => {
      const result = join("Users", "", "test", "file.txt");

      assert(result.includes("Users"));
      assert(result.includes("test"));
    });

    it("should handle single segment", () => {
      const result = join("file.txt");

      assertEquals(result, "file.txt");
    });

    it("should handle no segments", () => {
      const result = join();

      assertEquals(result, ".");
    });
  });

  describe("resolve", () => {
    it("should resolve absolute path", () => {
      const result = resolve("/Users", "test", "file.txt");

      assert(isAbsolute(result));
      assert(result.includes("file.txt"));
    });

    it("should resolve relative to current directory", () => {
      const result = resolve("file.txt");

      assert(isAbsolute(result));
    });

    it("should handle multiple segments", () => {
      const result = resolve("Users", "test", "file.txt");

      assert(isAbsolute(result));
    });

    it("should handle backtracking", () => {
      const result = resolve("/Users/test/../file.txt");

      assert(isAbsolute(result));
      assert(!result.includes(".."));
    });
  });

  describe("relative", () => {
    it("should compute relative path between two paths", () => {
      const result = relative("/Users/test", "/Users/test/file.txt");

      assertEquals(result, "file.txt");
    });

    it("should handle parent directory navigation", () => {
      const result = relative("/Users/test/nested", "/Users/test/file.txt");

      assert(result.includes(".."));
    });

    it("should handle same paths", () => {
      const result = relative("/Users/test", "/Users/test");

      assertEquals(result, "");
    });

    it("should handle deeply nested paths", () => {
      const result = relative(
        "/Users/test/a/b/c",
        "/Users/test/x/y/z"
      );

      assert(result.includes(".."));
    });
  });

  describe("isAbsolute", () => {
    it("should return true for absolute Unix path", () => {
      const result = isAbsolute("/Users/test/file.txt");

      assertEquals(result, true);
    });

    it("should return false for relative path", () => {
      const result = isAbsolute("Users/test/file.txt");

      assertEquals(result, false);
    });

    it("should return false for current directory", () => {
      const result = isAbsolute("./file.txt");

      assertEquals(result, false);
    });

    it("should return false for parent directory", () => {
      const result = isAbsolute("../file.txt");

      assertEquals(result, false);
    });

    it("should return false for empty path", () => {
      const result = isAbsolute("");

      assertEquals(result, false);
    });
  });

  describe("normalize", () => {
    it("should normalize path with redundant separators", () => {
      const result = normalize("Users//test///file.txt");

      assert(!result.includes("//"));
    });

    it("should resolve . segments", () => {
      const result = normalize("Users/./test/./file.txt");

      assert(!result.includes("/./"));
    });

    it("should resolve .. segments", () => {
      const result = normalize("Users/test/../file.txt");

      assert(!result.includes(".."));
    });

    it("should handle trailing slash", () => {
      const result = normalize("Users/test/");

      assertExists(result);
    });

    it("should handle empty path", () => {
      const result = normalize("");

      assertEquals(result, ".");
    });
  });

  describe("parse", () => {
    it("should parse path into components", () => {
      const result = parse("/Users/test/file.txt");

      assertEquals(result.base, "file.txt");
      assertEquals(result.name, "file");
      assertEquals(result.ext, ".txt");
      assertExists(result.dir);
    });

    it("should handle path without extension", () => {
      const result = parse("/Users/test/file");

      assertEquals(result.base, "file");
      assertEquals(result.name, "file");
      assertEquals(result.ext, "");
    });

    it("should handle root path", () => {
      const result = parse("/");

      assertEquals(result.dir, "/");
      assertEquals(result.base, "");
    });

    it("should handle relative path", () => {
      const result = parse("test/file.txt");

      assertEquals(result.base, "file.txt");
      assertEquals(result.name, "file");
      assertEquals(result.ext, ".txt");
    });
  });

  describe("format", () => {
    it("should format path from components", () => {
      const result = format({
        dir: "/Users/test",
        base: "file.txt",
      });

      assert(result.includes("Users"));
      assert(result.includes("test"));
      assert(result.includes("file.txt"));
    });

    it("should prefer base over name and ext", () => {
      const result = format({
        dir: "/Users/test",
        base: "file.txt",
        name: "other",
        ext: ".md",
      });

      assert(result.includes("file.txt"));
      assert(!result.includes("other.md"));
    });

    it("should combine name and ext", () => {
      const result = format({
        dir: "/Users/test",
        name: "file",
        ext: ".txt",
      });

      assert(result.includes("file.txt"));
    });

    it("should handle root", () => {
      const result = format({
        root: "/",
        base: "file.txt",
      });

      assertEquals(result, "/file.txt");
    });

    it("should handle empty components", () => {
      const result = format({});

      assertExists(result);
    });
  });

  describe("sep and delimiter", () => {
    it("should have separator defined", () => {
      assertExists(sep);
      assert(sep === "/" || sep === "\\");
    });

    it("should have delimiter defined", () => {
      assertExists(delimiter);
      assert(delimiter === ":" || delimiter === ";");
    });

    it("should have SEPARATOR constant", () => {
      assertExists(SEPARATOR);
      assertEquals(SEPARATOR, sep);
    });

    it("should have SEPARATOR_PATTERN defined", () => {
      assertExists(SEPARATOR_PATTERN);
      assert(SEPARATOR_PATTERN instanceof RegExp);
    });

    it("should match separators with SEPARATOR_PATTERN", () => {
      const unixPath = "Users/test/file.txt";
      const windowsPath = "Users\\test\\file.txt";

      assert(SEPARATOR_PATTERN.test(unixPath) || SEPARATOR_PATTERN.test(windowsPath));
    });
  });

  describe("cross-platform compatibility", () => {
    it("should handle paths on current platform", () => {
      const testPath = join("Users", "test", "file.txt");
      const normalized = normalize(testPath);
      const absolute = resolve(testPath);

      assertExists(normalized);
      assertExists(absolute);
      assertEquals(isAbsolute(absolute), true);
    });

    it("should parse and format consistently", () => {
      const original = join("Users", "test", "file.txt");
      const parsed = parse(original);
      const formatted = format(parsed);

      // Should result in equivalent paths
      assertEquals(normalize(original), normalize(formatted));
    });

    it("should handle URL conversion round-trip", () => {
      const absolutePath = resolve("test.txt");
      const url = toFileUrl(absolutePath);
      const converted = fromFileUrl(url);

      assertEquals(normalize(absolutePath), normalize(converted));
    });
  });
});
