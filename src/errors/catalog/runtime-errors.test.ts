import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RUNTIME_ERROR_CATALOG } from "./runtime-errors.ts";

describe("errors/catalog/runtime-errors", () => {
  describe("RUNTIME_ERROR_CATALOG", () => {
    it("should contain all runtime error slugs", () => {
      const expectedSlugs = [
        "hydration-mismatch",
        "render-error",
        "component-error",
        "layout-not-found",
        "page-not-found",
        "api-error",
        "middleware-error",
      ];

      for (const slug of expectedSlugs) {
        assertEquals(slug in RUNTIME_ERROR_CATALOG, true, `Missing error slug: ${slug}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [slug, solution] of Object.entries(RUNTIME_ERROR_CATALOG)) {
        assertEquals(solution.slug, slug, `slug mismatch for ${slug}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${slug}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${slug}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${slug}`);
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${slug}`);
        assertEquals(
          solution.steps?.length ? solution.steps.length > 0 : false,
          true,
          `steps should not be empty for ${slug}`,
        );
      }
    });

    it("should have 7 entries", () => {
      assertEquals(Object.keys(RUNTIME_ERROR_CATALOG).length, 7);
    });

    it("hydration-mismatch should have example and relatedErrors", () => {
      const solution = RUNTIME_ERROR_CATALOG["hydration-mismatch"]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(Array.isArray(solution.relatedErrors), true);
      assertEquals(solution.relatedErrors?.includes("render-error") ?? false, true);
    });

    it("layout-not-found should have an example", () => {
      const solution = RUNTIME_ERROR_CATALOG["layout-not-found"]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(solution.example?.includes("layout") ?? false, true);
    });
  });
});
