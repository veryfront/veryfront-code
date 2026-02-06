import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ROUTE_ERROR_CATALOG } from "./route-errors.ts";

describe("errors/catalog/route-errors", () => {
  describe("ROUTE_ERROR_CATALOG", () => {
    it("should contain all route error slugs", () => {
      const expectedSlugs = [
        "route-conflict",
        "invalid-route-file",
        "route-handler-invalid",
        "dynamic-route-error",
        "route-params-error",
        "api-route-error",
      ];

      for (const slug of expectedSlugs) {
        assertEquals(slug in ROUTE_ERROR_CATALOG, true, `Missing error slug: ${slug}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [slug, solution] of Object.entries(ROUTE_ERROR_CATALOG)) {
        assertEquals(solution.slug, slug, `slug mismatch for ${slug}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${slug}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${slug}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${slug}`);
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${slug}`);
        assertEquals(
          (solution.steps?.length ?? 0) > 0,
          true,
          `steps should not be empty for ${slug}`,
        );
      }
    });

    it("should have 6 entries", () => {
      assertEquals(Object.keys(ROUTE_ERROR_CATALOG).length, 6);
    });

    it("invalid-route-file should have an example", () => {
      const solution = ROUTE_ERROR_CATALOG["invalid-route-file"]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(solution.example?.includes("GET") ?? false, true);
    });
  });
});
