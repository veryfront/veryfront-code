import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { validatePathSecurity } from "./security.ts";

describe("platform/compat/path/security", () => {
  describe("validatePathSecurity", () => {
    it("should accept valid simple paths", () => {
      assertEquals(validatePathSecurity("/path/to/file.txt"), true);
      assertEquals(validatePathSecurity("path/to/file.txt"), true);
      assertEquals(validatePathSecurity("file.txt"), true);
    });

    it("should accept paths with dots in filenames", () => {
      assertEquals(validatePathSecurity("/path/to/file.min.js"), true);
      assertEquals(validatePathSecurity("test.config.js"), true);
    });

    it("should reject null or undefined", () => {
      assertEquals(validatePathSecurity(null as any), false);
      assertEquals(validatePathSecurity(undefined as any), false);
    });

    it("should reject excessively long paths", () => {
      const longPath = "a/".repeat(10000);
      assertEquals(validatePathSecurity(longPath), false);
    });

    it("should accept paths with single parent directory traversal", () => {
      assertEquals(validatePathSecurity("../file.txt"), true);
      assertEquals(validatePathSecurity("path/../file.txt"), true);
    });

    it("should accept normal paths with current directory", () => {
      assertEquals(validatePathSecurity("./file.txt"), true);
      assertEquals(validatePathSecurity("path/./file.txt"), true);
    });

    it("should reject excessive path traversal", () => {
      const traversal = "../".repeat(20);
      assertEquals(validatePathSecurity(traversal + "file.txt"), false);
    });

    it("should handle consecutive parent references", () => {
      assertEquals(validatePathSecurity("../../file.txt"), true);
      assertEquals(validatePathSecurity("../../../file.txt"), true);
    });

    it("should handle mixed slashes", () => {
      assertEquals(validatePathSecurity("path\\to\\file.txt"), true);
    });

    it("should accept absolute paths", () => {
      assertEquals(validatePathSecurity("/absolute/path/to/file"), true);
    });

    it("should accept paths with underscores and hyphens", () => {
      assertEquals(validatePathSecurity("my_file-name.txt"), true);
      assertEquals(validatePathSecurity("/path/to/my-file_name.txt"), true);
    });

    it("should accept empty path segments", () => {
      assertEquals(validatePathSecurity("path//file.txt"), true);
    });

    it("should reset depth counter on normal segments", () => {
      // After a normal segment, the traversal depth resets
      assertEquals(validatePathSecurity("../../normal/../file.txt"), true);
    });

    it("should handle complex valid paths", () => {
      assertEquals(validatePathSecurity("/home/user/documents/file.pdf"), true);
      assertEquals(validatePathSecurity("src/components/Button.tsx"), true);
      assertEquals(validatePathSecurity("./config/app.config.json"), true);
    });
  });
});
