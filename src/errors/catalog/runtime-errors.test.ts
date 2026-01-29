import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode } from "../error-codes.ts";
import { RUNTIME_ERROR_CATALOG } from "./runtime-errors.ts";

describe("errors/catalog/runtime-errors", () => {
  describe("RUNTIME_ERROR_CATALOG", () => {
    it("should contain all runtime error codes", () => {
      const expectedCodes = [
        ErrorCode.HYDRATION_MISMATCH,
        ErrorCode.RENDER_ERROR,
        ErrorCode.COMPONENT_ERROR,
        ErrorCode.LAYOUT_NOT_FOUND,
        ErrorCode.PAGE_NOT_FOUND,
        ErrorCode.API_ERROR,
        ErrorCode.MIDDLEWARE_ERROR,
      ];

      for (const code of expectedCodes) {
        assertEquals(code in RUNTIME_ERROR_CATALOG, true, `Missing error code: ${code}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [code, solution] of Object.entries(RUNTIME_ERROR_CATALOG)) {
        assertEquals(solution.code, code, `code mismatch for ${code}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${code}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${code}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${code}`);
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${code}`);
        assertEquals(solution.steps!.length > 0, true, `steps should not be empty for ${code}`);
      }
    });

    it("should have 7 entries", () => {
      assertEquals(Object.keys(RUNTIME_ERROR_CATALOG).length, 7);
    });

    it("HYDRATION_MISMATCH should have example and relatedErrors", () => {
      const solution = RUNTIME_ERROR_CATALOG[ErrorCode.HYDRATION_MISMATCH]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(Array.isArray(solution.relatedErrors), true);
      assertEquals(solution.relatedErrors!.includes(ErrorCode.RENDER_ERROR), true);
    });

    it("LAYOUT_NOT_FOUND should have an example", () => {
      const solution = RUNTIME_ERROR_CATALOG[ErrorCode.LAYOUT_NOT_FOUND]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(solution.example!.includes("layout"), true);
    });
  });
});
