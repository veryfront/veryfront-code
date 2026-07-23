import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { base64urlEncode } from "./base64url.ts";
import {
  fromBase64Url,
  getDirectory,
  getEsbuildLoader,
  getExtension,
  getExtensionName,
  hasHashedFilename,
  isAbsolutePath,
  isFrameworkSourcePath,
  isWithinDirectory,
  joinPath,
  normalizePath,
  toBase64Url,
} from "./path-utils.ts";

describe("path-utils", () => {
  describe("normalizePath", () => {
    it("should replace backslashes with forward slashes", () => {
      assertEquals(normalizePath("a\\b\\c"), "a/b/c");
    });

    it("should replace multiple backslashes", () => {
      assertEquals(normalizePath("a\\\\b"), "a/b");
    });

    it("should remove dot segments", () => {
      assertEquals(normalizePath("/a/./b"), "/a/b");
    });

    it("should remove trailing slash", () => {
      assertEquals(normalizePath("/a/b/"), "/a/b");
    });

    it("should not remove trailing slash from root", () => {
      assertEquals(normalizePath("/"), "/");
    });

    it("should handle empty segments", () => {
      assertEquals(normalizePath("/a/./b/./c"), "/a/b/c");
    });

    it("should resolve parent segments", () => {
      assertEquals(normalizePath("/root/../../etc/passwd"), "/etc/passwd");
    });
  });

  describe("joinPath", () => {
    it("should join two paths", () => {
      assertEquals(joinPath("/a", "b"), "/a/b");
    });

    it("should remove trailing slash from first part", () => {
      assertEquals(joinPath("/a/", "b"), "/a/b");
    });

    it("should remove leading slash from second part", () => {
      assertEquals(joinPath("/a", "/b"), "/a/b");
    });

    it("should handle both slashes", () => {
      assertEquals(joinPath("/a/", "/b"), "/a/b");
    });
  });

  describe("isWithinDirectory", () => {
    it("should return true for same directory", () => {
      assertEquals(isWithinDirectory("/root", "/root"), true);
    });

    it("should return true for child path", () => {
      assertEquals(isWithinDirectory("/root", "/root/child"), true);
    });

    it("should return true for nested child", () => {
      assertEquals(isWithinDirectory("/root", "/root/a/b/c"), true);
    });

    it("should return false for sibling path", () => {
      assertEquals(isWithinDirectory("/root", "/rootother"), false);
    });

    it("should return false for parent path", () => {
      assertEquals(isWithinDirectory("/root/child", "/root"), false);
    });

    it("should return false for unrelated path", () => {
      assertEquals(isWithinDirectory("/root", "/other"), false);
    });

    it("should return false for parent traversal outside the root", () => {
      assertEquals(isWithinDirectory("/root", "/root/../../etc/passwd"), false);
    });

    it("fails closed when the containment root is empty", () => {
      assertEquals(isWithinDirectory("", "/etc/passwd"), false);
      assertEquals(isWithinDirectory("", ""), false);
    });

    it("compares Windows paths case-insensitively", () => {
      assertEquals(isWithinDirectory("C:\\Project", "c:\\project\\src\\file.ts"), true);
      assertEquals(isWithinDirectory("C:\\Project", "c:\\project-other\\file.ts"), false);
      assertEquals(
        isWithinDirectory(
          "\\\\Server\\Share\\Project",
          "\\\\server\\share\\project\\src\\file.ts",
        ),
        true,
      );
    });
  });

  describe("getExtension", () => {
    it("should return extension with dot", () => {
      assertEquals(getExtension("file.ts"), ".ts");
    });

    it("should return last extension for multiple dots", () => {
      assertEquals(getExtension("file.test.ts"), ".ts");
    });

    it("should return empty string for no extension", () => {
      assertEquals(getExtension("file"), "");
    });

    it("should return empty string for trailing dot", () => {
      assertEquals(getExtension("file."), "");
    });

    it("should handle paths with directories", () => {
      assertEquals(getExtension("/path/to/file.tsx"), ".tsx");
    });

    it("does not treat a dot in a directory name as a file extension", () => {
      assertEquals(getExtension("/path.with.dot/file"), "");
      assertEquals(getExtensionName("/path.with.dot/file"), "");
    });

    it("does not treat a dotfile name as an extension", () => {
      assertEquals(getExtension("/project/.env"), "");
      assertEquals(getExtensionName("/project/.env"), "");
    });
  });

  describe("getExtensionName", () => {
    it("should return extension without dot, lowercased", () => {
      assertEquals(getExtensionName("file.TS"), "ts");
    });

    it("should return empty for no extension", () => {
      assertEquals(getExtensionName("file"), "");
    });

    it("should return empty for trailing dot", () => {
      assertEquals(getExtensionName("file."), "");
    });
  });

  describe("getDirectory", () => {
    it("should return parent directory", () => {
      assertEquals(getDirectory("/a/b/c.ts"), "/a/b");
    });

    it("should return root for top-level file", () => {
      assertEquals(getDirectory("/file.ts"), "/");
    });

    it("should return root for root path", () => {
      assertEquals(getDirectory("/"), "/");
    });
  });

  describe("hasHashedFilename", () => {
    it("should return true for hashed filenames", () => {
      assertEquals(hasHashedFilename("chunk.a1b2c3d4.js"), true);
    });

    it("should return true for longer hashes", () => {
      assertEquals(hasHashedFilename("file.a1b2c3d4e5f6.js"), true);
    });

    it("should return false for short segments", () => {
      assertEquals(hasHashedFilename("file.abc.js"), false);
    });

    it("should return false for non-hex segments", () => {
      assertEquals(hasHashedFilename("file.test.js"), false);
    });

    it("should return false for no middle segment", () => {
      assertEquals(hasHashedFilename("file.js"), false);
    });
  });

  describe("getEsbuildLoader", () => {
    it("should return tsx for .tsx files", () => {
      assertEquals(getEsbuildLoader("component.tsx"), "tsx");
    });

    it("should return jsx for .jsx files", () => {
      assertEquals(getEsbuildLoader("component.jsx"), "jsx");
    });

    it("should return ts for .ts files", () => {
      assertEquals(getEsbuildLoader("module.ts"), "ts");
    });

    it("should return js for .js files", () => {
      assertEquals(getEsbuildLoader("script.js"), "js");
    });

    it("should return js for unknown extensions", () => {
      assertEquals(getEsbuildLoader("file.mjs"), "js");
    });

    it("should be case-insensitive", () => {
      assertEquals(getEsbuildLoader("file.TSX"), "tsx");
    });
  });

  describe("isAbsolutePath", () => {
    it("should return true for unix absolute paths", () => {
      assertEquals(isAbsolutePath("/usr/bin"), true);
    });

    it("should return true for Windows paths", () => {
      assertEquals(isAbsolutePath("C:\\Users"), true);
    });

    it("should return true for Windows forward-slash paths", () => {
      assertEquals(isAbsolutePath("D:/Projects"), true);
    });

    it("should return false for relative paths", () => {
      assertEquals(isAbsolutePath("./relative"), false);
    });

    it("should return false for bare names", () => {
      assertEquals(isAbsolutePath("file.ts"), false);
    });
  });

  describe("toBase64Url / fromBase64Url", () => {
    it("should roundtrip a simple string", () => {
      const input = "hello world";
      assertEquals(fromBase64Url(toBase64Url(input)), input);
    });

    it("should roundtrip strings with special chars", () => {
      const input = "/path/to/file?query=1&other=2";
      assertEquals(fromBase64Url(toBase64Url(input)), input);
    });

    it("roundtrips Unicode paths as UTF-8", () => {
      const input = "/路線/📄.tsx";
      assertEquals(fromBase64Url(toBase64Url(input)), input);
    });

    it("should produce URL-safe output", () => {
      const encoded = toBase64Url("subjects?_d");
      assertEquals(encoded.includes("+"), false);
      assertEquals(encoded.includes("/"), false);
      assertEquals(encoded.includes("="), false);
    });

    it("should match the shared base64url encoder output", () => {
      const input = "/path/to/file?query=1&other=2";
      assertEquals(toBase64Url(input), base64urlEncode(input));
    });

    it("should return empty string for invalid base64url", () => {
      assertEquals(fromBase64Url("!!!invalid!!!"), "");
    });

    it("should fail closed for impossible one-character base64url input", () => {
      assertEquals(fromBase64Url("a"), "");
    });
  });

  describe("isFrameworkSourcePath", () => {
    it("recognizes only explicit framework namespaces", () => {
      assertEquals(isFrameworkSourcePath("_veryfront/react/component.tsx"), true);
      assertEquals(
        isFrameworkSourcePath("embedded:_veryfront/platform/runtime.ts"),
        true,
      );
    });

    it("does not misclassify user source directories as framework files", () => {
      assertEquals(isFrameworkSourcePath("src/react/component.tsx"), false);
      assertEquals(isFrameworkSourcePath("src/agent/runtime.ts"), false);
    });
  });
});
