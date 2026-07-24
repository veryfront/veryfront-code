import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ERROR_REGISTRY, type ErrorSlug } from "../error-registry.ts";
import {
  BUILD_ERROR_CATALOG,
  composeErrorCatalog,
  CONFIG_ERROR_CATALOG,
  DEPLOYMENT_ERROR_CATALOG,
  DEV_ERROR_CATALOG,
  ERROR_CATALOG,
  GENERAL_ERROR_CATALOG,
  getErrorSolution,
  MODULE_ERROR_CATALOG,
  ROUTE_ERROR_CATALOG,
  RSC_ERROR_CATALOG,
  RUNTIME_ERROR_CATALOG,
  searchErrors,
  SERVER_ERROR_CATALOG,
} from "./index.ts";
import { createSimpleError } from "./factory.ts";

describe("errors/catalog/index", () => {
  describe("ERROR_CATALOG", () => {
    it("should be a non-empty object", () => {
      assertEquals(typeof ERROR_CATALOG, "object");
      assertEquals(Object.keys(ERROR_CATALOG).length > 0, true);
    });

    it("should expose an immutable composed catalog", () => {
      assertEquals(Object.isFrozen(ERROR_CATALOG), true);
      assertEquals(Object.getPrototypeOf(ERROR_CATALOG), null);
    });

    it("should keep catalog fragments aligned with registry categories", () => {
      const categorizedCatalogs = {
        BUILD: BUILD_ERROR_CATALOG,
        CONFIG: CONFIG_ERROR_CATALOG,
        DEPLOY: DEPLOYMENT_ERROR_CATALOG,
        DEV: DEV_ERROR_CATALOG,
        GENERAL: GENERAL_ERROR_CATALOG,
        MODULE: MODULE_ERROR_CATALOG,
        ROUTE: ROUTE_ERROR_CATALOG,
        BOUNDARY: RSC_ERROR_CATALOG,
        RUNTIME: RUNTIME_ERROR_CATALOG,
        SERVER: SERVER_ERROR_CATALOG,
      } as const;

      for (const [expectedCategory, catalog] of Object.entries(categorizedCatalogs)) {
        for (const slug of Object.keys(catalog) as ErrorSlug[]) {
          assertEquals(
            ERROR_REGISTRY[slug].category,
            expectedCategory,
            `${slug} is published from the wrong catalog fragment`,
          );
        }
      }
    });

    it("rejects duplicate slugs while composing catalog fragments", () => {
      const first = {
        "build-failed": createSimpleError("build-failed", "Build failed", "First", ["Fix it"]),
      };
      const duplicate = {
        "build-failed": createSimpleError("build-failed", "Build failed", "Second", ["Fix it"]),
      };

      assertThrows(
        () => composeErrorCatalog(first, duplicate),
        Error,
        'Duplicate error catalog slug "build-failed"',
      );
    });

    it("rejects catalog keys that do not match the solution slug", () => {
      const mismatched = {
        "build-failed": createSimpleError("bundle-error", "Bundle failed", "Mismatch", [
          "Fix it",
        ]),
      };

      assertThrows(
        () => composeErrorCatalog(mismatched),
        Error,
        'Error catalog key "build-failed" does not match entry slug "bundle-error"',
      );
    });
  });

  describe("getErrorSolution", () => {
    it("should return null for unknown slug", () => {
      assertEquals(getErrorSolution("unknown-nonexistent-slug" as ErrorSlug), null);
    });

    it("should not return inherited object properties as solutions", () => {
      for (const slug of ["toString", "constructor", "__proto__"]) {
        assertEquals(getErrorSolution(slug as ErrorSlug), null);
      }
    });

    it("should return solution for known slug", () => {
      const solution = getErrorSolution("config-not-found");
      assertExists(solution);
      assertEquals(solution.slug, "config-not-found");
      assertEquals(typeof solution.title, "string");
      assertEquals(typeof solution.message, "string");
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

    it("should find an error by its exact slug", () => {
      const results = searchErrors("config-not-found");

      assertEquals(results.some((error) => error.slug === "config-not-found"), true);
    });

    it("should normalize spaces, underscores, and case when searching slugs", () => {
      for (const query of ["config not found", "CONFIG_NOT_FOUND"]) {
        const results = searchErrors(query);
        assertEquals(
          results.some((error) => error.slug === "config-not-found"),
          true,
          `Expected normalized slug query to match: ${query}`,
        );
      }
    });

    it("should trim text searches and reject empty queries", () => {
      const trimmed = searchErrors("  Configuration  ");
      assertEquals(trimmed.some((error) => error.slug === "config-not-found"), true);
      assertEquals(searchErrors("   "), []);
    });
  });
});
