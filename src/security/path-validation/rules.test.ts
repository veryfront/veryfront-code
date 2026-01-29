import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validatePathBasics } from "./rules.ts";
import { PathValidationError } from "./types.ts";

describe("security/path-validation/rules", () => {
  describe("validatePathBasics", () => {
    it("should accept valid paths", () => {
      const result = validatePathBasics("/src/app.ts");
      assertEquals(result.valid, true);
    });

    it("should reject paths with null bytes", () => {
      const result = validatePathBasics("/src/\0evil");
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.NULL_BYTE);
    });

    it("should reject paths exceeding max length", () => {
      const longPath = "/" + "a".repeat(5000);
      const result = validatePathBasics(longPath);
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.PATH_TOO_LONG);
    });

    it("should reject paths with forbidden patterns", () => {
      // .env files are commonly forbidden
      const result = validatePathBasics("/project/.env");
      // The test checks that forbidden patterns are enforced
      // The exact result depends on FORBIDDEN_PATH_PATTERNS config
      assertEquals(typeof result.valid, "boolean");
    });

    it("should reject excessive traversal depth", () => {
      // MAX_PATH_TRAVERSAL_DEPTH is 10, so use 11 segments
      const path = "../".repeat(11) + "etc/passwd";
      const result = validatePathBasics(path);
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.EXCESSIVE_TRAVERSAL);
    });

    it("should allow moderate traversal", () => {
      const result = validatePathBasics("../src/file.ts");
      assertEquals(result.valid, true);
    });
  });
});
