import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEPLOYMENT_ERROR_CATALOG } from "./deployment-errors.ts";

describe("errors/catalog/deployment-errors", () => {
  describe("DEPLOYMENT_ERROR_CATALOG", () => {
    it("should contain all deployment error slugs", () => {
      const expectedSlugs = [
        "deployment-error",
        "platform-error",
        "env-var-missing",
        "production-build-required",
      ];

      for (const slug of expectedSlugs) {
        assertEquals(slug in DEPLOYMENT_ERROR_CATALOG, true, `Missing error slug: ${slug}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [slug, solution] of Object.entries(DEPLOYMENT_ERROR_CATALOG)) {
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

    it("should have 4 entries", () => {
      assertEquals(Object.keys(DEPLOYMENT_ERROR_CATALOG).length, 4);
    });

    it("production-build-required should mention building first", () => {
      const solution = DEPLOYMENT_ERROR_CATALOG["production-build-required"]!;
      const hasBuildStep = solution.steps?.some((step) => step.includes("build")) ?? false;
      assertEquals(hasBuildStep, true);
    });
  });
});
