import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_PATH_LENGTH } from "#veryfront/utils/constants/security.ts";
import { validatePathSecurity } from "./security.ts";

describe("platform/compat/path/security", () => {
  describe("validatePathSecurity", () => {
    it("should accept simple paths", () => {
      assertEquals(validatePathSecurity("pages/index.tsx"), true);
    });

    it("should accept paths with leading slash", () => {
      assertEquals(validatePathSecurity("/home/user/file.ts"), true);
    });

    it("should reject null-ish paths", () => {
      assertEquals(validatePathSecurity(null as unknown as string), false);
    });

    it("should reject extremely long paths", () => {
      assertEquals(validatePathSecurity("a".repeat(10000)), false);
    });

    it("should reject paths containing an embedded NUL byte", () => {
      assertEquals(
        validatePathSecurity("pages/index.tsx\0.png"),
        false,
        "embedded NUL must be rejected",
      );
    });

    it("should enforce the path length limit at the exact boundary", () => {
      assertEquals(
        validatePathSecurity("a".repeat(MAX_PATH_LENGTH)),
        true,
        "a path exactly at the limit is accepted",
      );
      assertEquals(
        validatePathSecurity("a".repeat(MAX_PATH_LENGTH + 1)),
        false,
        "one character past the limit is rejected",
      );
    });

    it("should accept single dot components", () => {
      assertEquals(validatePathSecurity("./file.ts"), true);
    });

    it("should accept reasonable parent traversal", () => {
      assertEquals(validatePathSecurity("../file.ts"), true);
    });

    it("should reject excessive parent traversal", () => {
      const deepTraversal = "../".repeat(20) + "etc/passwd";
      assertEquals(validatePathSecurity(deepTraversal), false);
    });

    it("should reject excessive backslash parent traversal", () => {
      assertEquals(
        validatePathSecurity("..\\file.ts"),
        true,
        "a single backslash parent is still allowed",
      );
      assertEquals(
        validatePathSecurity("..\\".repeat(20) + "etc\\passwd"),
        false,
        "backslash traversal must be rejected like the forward-slash form",
      );
      assertEquals(
        validatePathSecurity("..\\../".repeat(10) + "etc\\passwd"),
        false,
        "mixed separators must not reset traversal depth",
      );
    });

    it("should accept empty string", () => {
      assertEquals(validatePathSecurity(""), true);
    });
  });
});
