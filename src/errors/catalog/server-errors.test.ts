import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode } from "../error-codes.ts";
import { SERVER_ERROR_CATALOG } from "./server-errors.ts";

describe("errors/catalog/server-errors", () => {
  describe("SERVER_ERROR_CATALOG", () => {
    it("should contain all server error codes", () => {
      const expectedCodes = [
        ErrorCode.PORT_IN_USE,
        ErrorCode.SERVER_START_ERROR,
        ErrorCode.HMR_ERROR,
        ErrorCode.CACHE_ERROR,
        ErrorCode.FILE_WATCH_ERROR,
        ErrorCode.REQUEST_ERROR,
      ];

      for (const code of expectedCodes) {
        assertEquals(code in SERVER_ERROR_CATALOG, true, `Missing error code: ${code}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [code, solution] of Object.entries(SERVER_ERROR_CATALOG)) {
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

    it("should have 6 entries", () => {
      assertEquals(Object.keys(SERVER_ERROR_CATALOG).length, 6);
    });

    it("PORT_IN_USE should have an example", () => {
      const solution = SERVER_ERROR_CATALOG[ErrorCode.PORT_IN_USE]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(solution.example?.includes("port") ?? false, true);
    });
  });
});
