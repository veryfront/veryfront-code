import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isAbsolute, normalize, relative, resolve } from "./resolution.ts";

describe("platform/compat/path/resolution", () => {
  describe("resolve", () => {
    it("should resolve absolute path", () => {
      assertEquals(resolve("/home/user"), "/home/user");
    });

    it("should resolve parent traversal", () => {
      assertEquals(resolve("/home/user/.."), "/home");
    });

    it("should resolve dot segments", () => {
      assertEquals(resolve("/home/./user"), "/home/user");
    });

    it("should use last absolute path", () => {
      assertEquals(resolve("/first", "/second"), "/second");
    });

    it("should handle Windows drive-letter paths", () => {
      assertEquals(
        resolve("D:/a/project/src/build", "..", "..", ".."),
        "D:/a",
      );
    });

    it("should handle Windows backslash paths", () => {
      assertEquals(
        resolve("D:\\a\\project\\src\\build", "..", "..", ".."),
        "D:/a",
      );
    });

    it("should preserve drive letter when resolving to root", () => {
      assertEquals(resolve("D:/a", ".."), "D:/");
    });
  });

  describe("isAbsolute", () => {
    it("should return true for absolute paths", () => {
      assertEquals(isAbsolute("/home/user"), true);
    });

    it("should return false for relative paths", () => {
      assertEquals(isAbsolute("home/user"), false);
    });

    it("should return false for dot-relative paths", () => {
      assertEquals(isAbsolute("./file"), false);
    });

    it("should return true for Windows drive-letter paths", () => {
      assertEquals(isAbsolute("D:/a/project"), true);
      assertEquals(isAbsolute("C:\\Users\\test"), true);
    });
  });

  describe("relative", () => {
    it("should compute relative path", () => {
      assertEquals(relative("/home/user", "/home/user/docs"), "docs");
    });

    it("should compute parent relative path", () => {
      assertEquals(relative("/home/user/docs", "/home/user"), "..");
    });

    it("should return . for same path", () => {
      assertEquals(relative("/home/user", "/home/user"), ".");
    });
  });

  describe("normalize", () => {
    it("should normalize dot segments", () => {
      assertEquals(normalize("/home/./user"), "/home/user");
    });

    it("should normalize parent traversal", () => {
      assertEquals(normalize("/home/user/../docs"), "/home/docs");
    });

    it("should normalize multiple slashes", () => {
      assertEquals(normalize("/home//user"), "/home/user");
    });

    it("should return . for empty string", () => {
      assertEquals(normalize(""), ".");
    });

    it("should preserve absolute path root", () => {
      assertEquals(normalize("/"), "/");
    });

    it("should handle relative parent traversal", () => {
      assertEquals(normalize("../foo"), "../foo");
    });

    it("should normalize Windows backslash paths", () => {
      assertEquals(normalize("D:\\a\\project\\src\\..\\lib"), "D:/a/project/lib");
    });

    it("should preserve Windows drive letter", () => {
      assertEquals(normalize("D:/"), "D:/");
    });
  });
});
