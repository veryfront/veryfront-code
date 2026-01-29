import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode } from "../error-codes.ts";
import { BUILD_ERROR_CATALOG } from "./build-errors.ts";

describe("errors/catalog/build-errors", () => {
  describe("BUILD_ERROR_CATALOG", () => {
    it("should contain all build error codes", () => {
      const expectedCodes = [
        ErrorCode.BUILD_FAILED,
        ErrorCode.BUNDLE_ERROR,
        ErrorCode.TYPESCRIPT_ERROR,
        ErrorCode.MDX_COMPILE_ERROR,
        ErrorCode.ASSET_OPTIMIZATION_ERROR,
        ErrorCode.SSG_GENERATION_ERROR,
        ErrorCode.SOURCEMAP_ERROR,
      ];

      for (const code of expectedCodes) {
        assertEquals(code in BUILD_ERROR_CATALOG, true, `Missing error code: ${code}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [code, solution] of Object.entries(BUILD_ERROR_CATALOG)) {
        assertEquals(solution.code, code, `code mismatch for ${code}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${code}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${code}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${code}`);
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${code}`);
        assertEquals(solution.steps!.length > 0, true, `steps should not be empty for ${code}`);
      }
    });

    it("should have 7 entries", () => {
      assertEquals(Object.keys(BUILD_ERROR_CATALOG).length, 7);
    });

    it("BUILD_FAILED should have tips", () => {
      const solution = BUILD_ERROR_CATALOG[ErrorCode.BUILD_FAILED]!;
      assertEquals(Array.isArray(solution.tips), true);
      assertEquals(solution.tips!.length > 0, true);
    });

    it("MDX_COMPILE_ERROR should have an example", () => {
      const solution = BUILD_ERROR_CATALOG[ErrorCode.MDX_COMPILE_ERROR]!;
      assertEquals(typeof solution.example, "string");
    });
  });
});
