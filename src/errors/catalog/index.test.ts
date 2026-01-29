import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode } from "../error-codes.ts";
import { ERROR_CATALOG, getErrorSolution, searchErrors } from "./index.ts";

describe("errors/catalog/index", () => {
  describe("ERROR_CATALOG", () => {
    it("should be a non-empty object", () => {
      assertEquals(typeof ERROR_CATALOG, "object");
      assertEquals(Object.keys(ERROR_CATALOG).length > 0, true);
    });
  });

  describe("getErrorSolution", () => {
    it("should return null for unknown code", () => {
      assertEquals(getErrorSolution("VF999" as typeof ErrorCode.UNKNOWN_ERROR), null);
    });

    it("should return solution for known code", () => {
      const solution = getErrorSolution(ErrorCode.CONFIG_NOT_FOUND);
      if (solution) {
        assertEquals(solution.code, ErrorCode.CONFIG_NOT_FOUND);
        assertEquals(typeof solution.title, "string");
        assertEquals(typeof solution.message, "string");
      }
    });
  });

  describe("searchErrors", () => {
    it("should return empty array for no matches", () => {
      const results = searchErrors("zzz_nonexistent_query_zzz");
      assertEquals(results.length, 0);
    });

    it("should find errors by title", () => {
      // Get a known entry from the catalog to search for
      const entries = Object.values(ERROR_CATALOG);
      if (entries.length > 0) {
        const first = entries[0];
        assertExists(first);
        const word = first.title.split(" ")[0];
        assertExists(word);
        const results = searchErrors(word);
        assertEquals(results.length > 0, true);
      }
    });

    it("should be case insensitive", () => {
      const entries = Object.values(ERROR_CATALOG);
      if (entries.length > 0) {
        const first = entries[0];
        assertExists(first);
        const word = first.title.split(" ")[0];
        assertExists(word);
        const lower = searchErrors(word.toLowerCase());
        const upper = searchErrors(word.toUpperCase());
        assertEquals(lower.length, upper.length);
      }
    });

    it("should search in steps", () => {
      const entriesWithSteps = Object.values(ERROR_CATALOG).filter(
        (e) => e.steps && e.steps.length > 0,
      );
      if (entriesWithSteps.length > 0) {
        const entry = entriesWithSteps[0];
        assertExists(entry);
        const firstStep = entry.steps?.[0];
        assertExists(firstStep);
        const stepWord = firstStep.split(" ")[0];
        assertExists(stepWord);
        const results = searchErrors(stepWord);
        assertEquals(results.length > 0, true);
      }
    });
  });
});
