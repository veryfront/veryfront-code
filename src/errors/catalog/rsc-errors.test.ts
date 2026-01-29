import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode } from "../error-codes.ts";
import { RSC_ERROR_CATALOG } from "./rsc-errors.ts";

describe("errors/catalog/rsc-errors", () => {
  describe("RSC_ERROR_CATALOG", () => {
    it("should contain all RSC error codes", () => {
      const expectedCodes = [
        ErrorCode.CLIENT_BOUNDARY_VIOLATION,
        ErrorCode.SERVER_ONLY_IN_CLIENT,
        ErrorCode.CLIENT_ONLY_IN_SERVER,
        ErrorCode.INVALID_USE_CLIENT,
        ErrorCode.INVALID_USE_SERVER,
        ErrorCode.RSC_PAYLOAD_ERROR,
      ];

      for (const code of expectedCodes) {
        assertEquals(code in RSC_ERROR_CATALOG, true, `Missing error code: ${code}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [code, solution] of Object.entries(RSC_ERROR_CATALOG)) {
        assertEquals(solution.code, code, `code mismatch for ${code}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${code}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${code}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${code}`);
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${code}`);
        assertEquals(solution.steps!.length > 0, true, `steps should not be empty for ${code}`);
      }
    });

    it("should have 6 entries", () => {
      assertEquals(Object.keys(RSC_ERROR_CATALOG).length, 6);
    });

    it("CLIENT_BOUNDARY_VIOLATION should have an example", () => {
      const solution = RSC_ERROR_CATALOG[ErrorCode.CLIENT_BOUNDARY_VIOLATION]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(solution.example!.includes("use client"), true);
    });

    it("INVALID_USE_CLIENT should have an example", () => {
      const solution = RSC_ERROR_CATALOG[ErrorCode.INVALID_USE_CLIENT]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(solution.example!.includes("use client"), true);
    });
  });
});
