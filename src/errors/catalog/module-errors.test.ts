import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode } from "../error-codes.ts";
import { MODULE_ERROR_CATALOG } from "./module-errors.ts";

describe("errors/catalog/module-errors", () => {
  describe("MODULE_ERROR_CATALOG", () => {
    it("should contain all module error codes", () => {
      const expectedCodes = [
        ErrorCode.CACHE_PATH_MISMATCH,
        ErrorCode.MODULE_NOT_FOUND,
        ErrorCode.IMPORT_RESOLUTION_ERROR,
        ErrorCode.CIRCULAR_DEPENDENCY,
        ErrorCode.INVALID_IMPORT,
        ErrorCode.DEPENDENCY_MISSING,
        ErrorCode.VERSION_MISMATCH,
      ];

      for (const code of expectedCodes) {
        assertEquals(code in MODULE_ERROR_CATALOG, true, `Missing error code: ${code}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [code, solution] of Object.entries(MODULE_ERROR_CATALOG)) {
        assertEquals(solution.code, code, `code mismatch for ${code}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${code}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${code}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${code}`);
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${code}`);
        assertEquals(
          (solution.steps?.length ?? 0) > 0,
          true,
          `steps should not be empty for ${code}`,
        );
      }
    });

    it("should have 7 entries", () => {
      assertEquals(Object.keys(MODULE_ERROR_CATALOG).length, 7);
    });

    it("CACHE_PATH_MISMATCH should have an example with curl command", () => {
      const solution = MODULE_ERROR_CATALOG[ErrorCode.CACHE_PATH_MISMATCH];
      assertEquals(typeof solution?.example, "string");
      assertEquals(solution?.example?.includes("curl"), true);
    });

    it("MODULE_NOT_FOUND should have an example with import map", () => {
      const solution = MODULE_ERROR_CATALOG[ErrorCode.MODULE_NOT_FOUND];
      assertEquals(typeof solution?.example, "string");
      assertEquals(solution?.example?.includes("importMap"), true);
    });

    it("DEPENDENCY_MISSING should have an example", () => {
      const solution = MODULE_ERROR_CATALOG[ErrorCode.DEPENDENCY_MISSING];
      assertEquals(typeof solution?.example, "string");
      assertEquals(solution?.example?.includes("react"), true);
    });
  });
});
