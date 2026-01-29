import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode } from "../error-codes.ts";
import { GENERAL_ERROR_CATALOG } from "./general-errors.ts";

describe("errors/catalog/general-errors", () => {
  describe("GENERAL_ERROR_CATALOG", () => {
    it("should contain all general error codes", () => {
      const expectedCodes = [
        ErrorCode.UNKNOWN_ERROR,
        ErrorCode.PERMISSION_DENIED,
        ErrorCode.FILE_NOT_FOUND,
        ErrorCode.INVALID_ARGUMENT,
        ErrorCode.TIMEOUT_ERROR,
      ];

      for (const code of expectedCodes) {
        assertEquals(code in GENERAL_ERROR_CATALOG, true, `Missing error code: ${code}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [code, solution] of Object.entries(GENERAL_ERROR_CATALOG)) {
        assertEquals(solution.code, code, `code mismatch for ${code}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${code}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${code}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${code}`);
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${code}`);
        assertEquals(solution.steps!.length > 0, true, `steps should not be empty for ${code}`);
      }
    });

    it("should have 5 entries", () => {
      assertEquals(Object.keys(GENERAL_ERROR_CATALOG).length, 5);
    });

    it("UNKNOWN_ERROR should suggest running veryfront doctor", () => {
      const solution = GENERAL_ERROR_CATALOG[ErrorCode.UNKNOWN_ERROR]!;
      const hasDoctor = solution.steps!.some((step) => step.includes("doctor"));
      assertEquals(hasDoctor, true);
    });
  });
});
