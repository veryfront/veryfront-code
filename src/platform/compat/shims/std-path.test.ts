import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  fromFileUrl,
  toFileUrl,
  basename,
  dirname,
  extname,
  join,
  normalize,
  parse,
  format,
  isAbsolute,
  relative,
  resolve,
  sep,
  SEPARATOR,
  delimiter,
} from "./std-path.ts";

describe("platform/compat/shims/std-path", () => {
  describe("fromFileUrl", () => {
    it("should convert file:// URL to path", () => {
      const path = fromFileUrl("file:///tmp/test.txt");
      assertEquals(path, "/tmp/test.txt");
    });

    it("should handle URL object", () => {
      const path = fromFileUrl(new URL("file:///home/user/file.ts"));
      assertEquals(path, "/home/user/file.ts");
    });
  });

  describe("toFileUrl", () => {
    it("should convert path to file:// URL", () => {
      const url = toFileUrl("/tmp/test.txt");
      assertEquals(url.protocol, "file:");
      assertEquals(url.pathname, "/tmp/test.txt");
    });
  });

  describe("basename", () => {
    it("should return the last portion of a path", () => {
      assertEquals(basename("/foo/bar/baz.ts"), "baz.ts");
    });

    it("should handle trailing slash", () => {
      assertEquals(basename("/foo/bar/"), "bar");
    });
  });

  describe("dirname", () => {
    it("should return the directory of a path", () => {
      assertEquals(dirname("/foo/bar/baz.ts"), "/foo/bar");
    });
  });

  describe("extname", () => {
    it("should return the extension", () => {
      assertEquals(extname("file.ts"), ".ts");
    });

    it("should return empty string for no extension", () => {
      assertEquals(extname("Makefile"), "");
    });

    it("should handle dotfiles", () => {
      assertEquals(extname(".gitignore"), "");
    });
  });

  describe("join", () => {
    it("should join path segments", () => {
      assertEquals(join("foo", "bar", "baz.ts"), "foo/bar/baz.ts");
    });

    it("should handle leading slash", () => {
      assertEquals(join("/foo", "bar"), "/foo/bar");
    });
  });

  describe("normalize", () => {
    it("should resolve . and ..", () => {
      assertEquals(normalize("/foo/bar/../baz"), "/foo/baz");
    });

    it("should collapse multiple slashes", () => {
      assertEquals(normalize("/foo//bar"), "/foo/bar");
    });
  });

  describe("isAbsolute", () => {
    it("should return true for absolute paths", () => {
      assertEquals(isAbsolute("/foo/bar"), true);
    });

    it("should return false for relative paths", () => {
      assertEquals(isAbsolute("foo/bar"), false);
    });
  });

  describe("parse/format", () => {
    it("should parse a path into components", () => {
      const parsed = parse("/home/user/file.ts");
      assertEquals(parsed.root, "/");
      assertEquals(parsed.dir, "/home/user");
      assertEquals(parsed.base, "file.ts");
      assertEquals(parsed.ext, ".ts");
      assertEquals(parsed.name, "file");
    });

    it("should format components back to a path", () => {
      const formatted = format({ root: "/", dir: "/home/user", base: "file.ts" });
      assertEquals(formatted, "/home/user/file.ts");
    });
  });

  describe("relative", () => {
    it("should compute relative path", () => {
      assertEquals(relative("/foo/bar", "/foo/baz"), "../baz");
    });
  });

  describe("resolve", () => {
    it("should resolve to an absolute path", () => {
      const result = resolve("foo");
      assertEquals(isAbsolute(result), true);
    });
  });

  describe("constants", () => {
    it("should export sep", () => {
      assertExists(sep);
      assertEquals(sep, "/");
    });

    it("should export SEPARATOR equal to sep", () => {
      assertEquals(SEPARATOR, sep);
    });

    it("should export delimiter", () => {
      assertExists(delimiter);
      assertEquals(delimiter, ":");
    });
  });
});
