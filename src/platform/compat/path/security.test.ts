import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
      const longPath = "a".repeat(10000);
      assertEquals(validatePathSecurity(longPath), false);
    });

    it("should accept single dot components", () => {
      assertEquals(validatePathSecurity("./file.ts"), true);
    });

    it("should accept reasonable parent traversal", () => {
      assertEquals(validatePathSecurity("../file.ts"), true);
    });

    it("should reject excessive parent traversal", () => {
      // Multiple consecutive .. segments
      const deepTraversal = "../".repeat(20) + "etc/passwd";
      assertEquals(validatePathSecurity(deepTraversal), false);
    });

    it("should accept empty string", () => {
      assertEquals(validatePathSecurity(""), true);
    });
  });
});
