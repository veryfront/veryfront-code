import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ErrorSlug } from "../error-registry.ts";
import { ERROR_REGISTRY } from "../error-registry.ts";
import { ERROR_CATALOG, getErrorSolution, searchErrors } from "./index.ts";

describe("errors/catalog/index", () => {
  describe("ERROR_CATALOG", () => {
    it("should be a non-empty object", () => {
      assertEquals(typeof ERROR_CATALOG, "object");
      assertEquals(Object.keys(ERROR_CATALOG).length > 0, true);
    });

    it("documents every registered error slug", () => {
      assertEquals(
        Object.keys(ERROR_REGISTRY).filter((slug) => !Object.hasOwn(ERROR_CATALOG, slug)),
        [],
      );
      assertEquals(Object.keys(ERROR_CATALOG).length, Object.keys(ERROR_REGISTRY).length);
    });

    it("contains no internal runbook or credential material", () => {
      const serialized = JSON.stringify(ERROR_CATALOG);
      for (
        const forbidden of [
          "kubectl",
          "Authorization",
          "/internal/",
          "renderer pods",
          "ADMIN_TOKEN",
          "veryfront-production",
        ]
      ) {
        assertEquals(serialized.includes(forbidden), false);
      }
    });
  });

  describe("getErrorSolution", () => {
    it("should return null for unknown slug", () => {
      assertEquals(getErrorSolution("unknown-nonexistent-slug" as ErrorSlug), null);
    });

    it("should return solution for known slug", () => {
      const solution = getErrorSolution("config-not-found");
      assertExists(solution);
      assertEquals(solution.slug, "config-not-found");
      assertEquals(typeof solution.title, "string");
      assertEquals(typeof solution.message, "string");
    });

    it("does not resolve inherited object properties", () => {
      assertEquals(getErrorSolution("__proto__" as never), null);
      assertEquals(getErrorSolution("constructor" as never), null);
    });
  });

  describe("searchErrors", () => {
    it("should return empty array for no matches", () => {
      const results = searchErrors("zzz_nonexistent_query_zzz");
      assertEquals(results.length, 0);
    });

    it("should find errors by title", () => {
      const entries = Object.values(ERROR_CATALOG);
      assertEquals(entries.length > 0, true);

      const first = entries[0];
      assertExists(first);

      const word = first.title.split(" ")[0];
      assertExists(word);

      const results = searchErrors(word);
      assertEquals(results.length > 0, true);
    });

    it("should be case insensitive", () => {
      const entries = Object.values(ERROR_CATALOG);
      assertEquals(entries.length > 0, true);

      const first = entries[0];
      assertExists(first);

      const word = first.title.split(" ")[0];
      assertExists(word);

      const lower = searchErrors(word.toLowerCase());
      const upper = searchErrors(word.toUpperCase());
      assertEquals(lower.length, upper.length);
    });

    it("should search in steps", () => {
      const entriesWithSteps = Object.values(ERROR_CATALOG).filter(
        (e) => e.steps && e.steps.length > 0,
      );
      assertEquals(entriesWithSteps.length > 0, true);

      const entry = entriesWithSteps[0];
      assertExists(entry);

      const firstStep = entry.steps?.[0];
      assertExists(firstStep);

      const stepWord = firstStep.split(" ")[0];
      assertExists(stepWord);

      const results = searchErrors(stepWord);
      assertEquals(results.length > 0, true);
    });

    it("rejects malformed and oversized search terms", () => {
      assertThrows(() => searchErrors(42 as never), TypeError, "query must be a string");
      assertThrows(
        () => searchErrors("x".repeat(257)),
        TypeError,
        "query must not exceed 256 characters",
      );
    });
  });
});
