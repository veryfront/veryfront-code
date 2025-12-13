import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  normalizePath,
  joinPath,
  isWithinDirectory,
  getExtension,
  getDirectory,
  hasHashedFilename,
  isAbsolutePath,
  toBase64Url,
  fromBase64Url,
} from "./path-utils.ts";

describe("utils/path-utils", () => {
  describe("normalizePath", () => {
    it("should normalize forward slashes", () => {
      assertEquals(normalizePath("/a/b/c"), "/a/b/c");
    });

    it("should convert backslashes to forward slashes", () => {
      assertEquals(normalizePath("\\a\\b\\c"), "/a/b/c");
    });

    it("should remove trailing slashes except root", () => {
      assertEquals(normalizePath("/a/b/"), "/a/b");
      assertEquals(normalizePath("/"), "/");
    });

    it("should handle dot segments", () => {
      assertEquals(normalizePath("/a/./b"), "/a/b");
    });

    it("should handle empty paths", () => {
      assertEquals(normalizePath(""), "");
    });
  });

  describe("joinPath", () => {
    it("should join two paths", () => {
      assertEquals(joinPath("/a", "b"), "/a/b");
    });

    it("should handle trailing slash in first path", () => {
      assertEquals(joinPath("/a/", "b"), "/a/b");
    });

    it("should handle leading slash in second path", () => {
      assertEquals(joinPath("/a", "/b"), "/a/b");
    });

    it("should handle both slashes", () => {
      assertEquals(joinPath("/a/", "/b"), "/a/b");
    });

    it("should join root path", () => {
      assertEquals(joinPath("/", "a"), "/a");
    });
  });

  describe("isWithinDirectory", () => {
    it("should return true for direct child", () => {
      assertEquals(isWithinDirectory("/root", "/root/child"), true);
    });

    it("should return true for nested child", () => {
      assertEquals(isWithinDirectory("/root", "/root/a/b/c"), true);
    });

    it("should return false for sibling", () => {
      assertEquals(isWithinDirectory("/root", "/other"), false);
    });

    it("should return true for same directory", () => {
      assertEquals(isWithinDirectory("/root", "/root"), true);
    });

    it("should return false for parent", () => {
      assertEquals(isWithinDirectory("/root/child", "/root"), false);
    });
  });

  describe("getExtension", () => {
    it("should get file extension", () => {
      assertEquals(getExtension("file.txt"), ".txt");
      assertEquals(getExtension("file.test.ts"), ".ts");
    });

    it("should return empty for no extension", () => {
      assertEquals(getExtension("file"), "");
    });

    it("should handle dotfiles", () => {
      // Dotfiles like .gitignore return .gitignore as extension
      const ext = getExtension(".gitignore");
      assertEquals(ext, ".gitignore");
    });

    it("should handle trailing dot", () => {
      assertEquals(getExtension("file."), "");
    });
  });

  describe("getDirectory", () => {
    it("should get directory path", () => {
      assertEquals(getDirectory("/a/b/c.txt"), "/a/b");
    });

    it("should handle root files", () => {
      assertEquals(getDirectory("/file.txt"), "/");
    });

    it("should handle nested paths", () => {
      assertEquals(getDirectory("/a/b/c/d.txt"), "/a/b/c");
    });
  });

  describe("hasHashedFilename", () => {
    it("should detect hashed filenames", () => {
      assertEquals(hasHashedFilename("bundle.abc12345.js"), true);
      assertEquals(hasHashedFilename("style.1234abcd.css"), true);
    });

    it("should reject non-hashed filenames", () => {
      assertEquals(hasHashedFilename("bundle.js"), false);
      assertEquals(hasHashedFilename("style.css"), false);
    });

    it("should require minimum hash length", () => {
      assertEquals(hasHashedFilename("file.abc.js"), false);
      assertEquals(hasHashedFilename("file.abcdef12.js"), true);
    });
  });

  describe("isAbsolutePath", () => {
    it("should detect Unix absolute paths", () => {
      assertEquals(isAbsolutePath("/usr/bin"), true);
      assertEquals(isAbsolutePath("/"), true);
    });

    it("should detect Windows absolute paths", () => {
      assertEquals(isAbsolutePath("C:\\Windows"), true);
      assertEquals(isAbsolutePath("D:/Data"), true);
    });

    it("should reject relative paths", () => {
      assertEquals(isAbsolutePath("./relative"), false);
      assertEquals(isAbsolutePath("relative"), false);
    });
  });

  describe("toBase64Url and fromBase64Url", () => {
    it("should encode to base64url", () => {
      const encoded = toBase64Url("hello");
      assert(typeof encoded === "string");
      assert(!encoded.includes("+"));
      assert(!encoded.includes("/"));
      assert(!encoded.includes("="));
    });

    it("should decode from base64url", () => {
      const original = "hello world";
      const encoded = toBase64Url(original);
      const decoded = fromBase64Url(encoded);
      assertEquals(decoded, original);
    });

    it("should handle special characters", () => {
      const original = "test+/=";
      const encoded = toBase64Url(original);
      const decoded = fromBase64Url(encoded);
      assertEquals(decoded, original);
    });

    it("should handle empty string", () => {
      const encoded = toBase64Url("");
      const decoded = fromBase64Url(encoded);
      assertEquals(decoded, "");
    });

    it("should handle roundtrip", () => {
      const testCases = ["a", "ab", "abc", "test@example.com", "hello world!"];
      for (const test of testCases) {
        const encoded = toBase64Url(test);
        const decoded = fromBase64Url(encoded);
        assertEquals(decoded, test);
      }
    });
  });
});
