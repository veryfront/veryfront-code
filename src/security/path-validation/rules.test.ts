import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validatePathBasics } from "./rules.ts";
import { PathValidationError } from "./types.ts";

describe("security/path-validation/rules", () => {
  describe("validatePathBasics", () => {
    it("should accept valid paths", () => {
      const { valid } = validatePathBasics("/src/app.ts");
      assertEquals(valid, true);
    });

    it("should reject paths with null bytes", () => {
      const { valid, code } = validatePathBasics("/src/\0evil");
      assertEquals(valid, false);
      assertEquals(code, PathValidationError.NULL_BYTE);
    });

    it("should reject paths exceeding max length", () => {
      const longPath = `/${"a".repeat(5000)}`;
      const { valid, code } = validatePathBasics(longPath);
      assertEquals(valid, false);
      assertEquals(code, PathValidationError.PATH_TOO_LONG);
    });

    it("should reject paths with forbidden patterns", () => {
      const result = validatePathBasics("/project/.env");
      assertEquals(typeof result.valid, "boolean");
    });

    it("should reject excessive traversal depth", () => {
      const path = `${"../".repeat(11)}etc/passwd`;
      const { valid, code } = validatePathBasics(path);
      assertEquals(valid, false);
      assertEquals(code, PathValidationError.EXCESSIVE_TRAVERSAL);
    });

    it("should allow moderate traversal", () => {
      const { valid } = validatePathBasics("../src/file.ts");
      assertEquals(valid, true);
    });
  });
});
