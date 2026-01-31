import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode } from "../error-codes.ts";
import { ROUTE_ERROR_CATALOG } from "./route-errors.ts";

describe("errors/catalog/route-errors", () => {
  describe("ROUTE_ERROR_CATALOG", () => {
    it("should contain all route error codes", () => {
      const expectedCodes = [
        ErrorCode.ROUTE_CONFLICT,
        ErrorCode.INVALID_ROUTE_FILE,
        ErrorCode.ROUTE_HANDLER_INVALID,
        ErrorCode.DYNAMIC_ROUTE_ERROR,
        ErrorCode.ROUTE_PARAMS_ERROR,
        ErrorCode.API_ROUTE_ERROR,
      ];

      for (const code of expectedCodes) {
        assertEquals(code in ROUTE_ERROR_CATALOG, true, `Missing error code: ${code}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [code, solution] of Object.entries(ROUTE_ERROR_CATALOG)) {
        assertEquals(solution.code, code, `code mismatch for ${code}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${code}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${code}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${code}`);
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${code}`);
        assertEquals(solution.steps.length > 0, true, `steps should not be empty for ${code}`);
      }
    });

    it("should have 6 entries", () => {
      assertEquals(Object.keys(ROUTE_ERROR_CATALOG).length, 6);
    });

    it("INVALID_ROUTE_FILE should have an example", () => {
      const solution = ROUTE_ERROR_CATALOG[ErrorCode.INVALID_ROUTE_FILE]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(solution.example.includes("GET"), true);
    });
  });
});
