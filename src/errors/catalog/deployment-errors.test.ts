import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode } from "../error-codes.ts";
import { DEPLOYMENT_ERROR_CATALOG } from "./deployment-errors.ts";

describe("errors/catalog/deployment-errors", () => {
  describe("DEPLOYMENT_ERROR_CATALOG", () => {
    it("should contain all deployment error codes", () => {
      const expectedCodes = [
        ErrorCode.DEPLOYMENT_ERROR,
        ErrorCode.PLATFORM_ERROR,
        ErrorCode.ENV_VAR_MISSING,
        ErrorCode.PRODUCTION_BUILD_REQUIRED,
      ];

      for (const code of expectedCodes) {
        assertEquals(code in DEPLOYMENT_ERROR_CATALOG, true, `Missing error code: ${code}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [code, solution] of Object.entries(DEPLOYMENT_ERROR_CATALOG)) {
        assertEquals(solution.code, code, `code mismatch for ${code}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${code}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${code}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${code}`);
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${code}`);
        assertEquals(solution.steps!.length > 0, true, `steps should not be empty for ${code}`);
      }
    });

    it("should have 4 entries", () => {
      assertEquals(Object.keys(DEPLOYMENT_ERROR_CATALOG).length, 4);
    });

    it("PRODUCTION_BUILD_REQUIRED should mention building first", () => {
      const solution = DEPLOYMENT_ERROR_CATALOG[ErrorCode.PRODUCTION_BUILD_REQUIRED]!;
      const hasBuildStep = solution.steps!.some((step) => step.includes("build"));
      assertEquals(hasBuildStep, true);
    });
  });
});
