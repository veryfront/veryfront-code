import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode } from "../error-codes.ts";
import { DEV_ERROR_CATALOG } from "./dev-errors.ts";

describe("errors/catalog/dev-errors", () => {
  describe("DEV_ERROR_CATALOG", () => {
    it("should contain all dev error codes", () => {
      const expectedCodes = [
        ErrorCode.DEV_SERVER_ERROR,
        ErrorCode.FAST_REFRESH_ERROR,
        ErrorCode.ERROR_OVERLAY_ERROR,
        ErrorCode.SOURCE_MAP_ERROR,
      ];

      for (const code of expectedCodes) {
        assertEquals(code in DEV_ERROR_CATALOG, true, `Missing error code: ${code}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [code, solution] of Object.entries(DEV_ERROR_CATALOG)) {
        assertEquals(solution.code, code, `code mismatch for ${code}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${code}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${code}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${code}`);
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${code}`);
        assertEquals(solution.steps.length > 0, true, `steps should not be empty for ${code}`);
      }
    });

    it("should have 4 entries", () => {
      assertEquals(Object.keys(DEV_ERROR_CATALOG).length, 4);
    });

    it("DEV_SERVER_ERROR should suggest restarting dev server", () => {
      const solution = DEV_ERROR_CATALOG[ErrorCode.DEV_SERVER_ERROR]!;
      const hasRestart = solution.steps!.some((step) => step.toLowerCase().includes("restart"));
      assertEquals(hasRestart, true);
    });
  });
});
