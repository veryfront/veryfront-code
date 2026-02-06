import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { GENERAL_ERROR_CATALOG } from "./general-errors.ts";

describe("errors/catalog/general-errors", () => {
  describe("GENERAL_ERROR_CATALOG", () => {
    it("should contain all general error slugs", () => {
      const expectedSlugs = [
        "unknown-error",
        "permission-denied",
        "file-not-found",
        "invalid-argument",
        "timeout-error",
      ];

      for (const slug of expectedSlugs) {
        assertEquals(slug in GENERAL_ERROR_CATALOG, true, `Missing error slug: ${slug}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [slug, solution] of Object.entries(GENERAL_ERROR_CATALOG)) {
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

    it("should have 5 entries", () => {
      assertEquals(Object.keys(GENERAL_ERROR_CATALOG).length, 5);
    });

    it("unknown-error should suggest running veryfront doctor", () => {
      const solution = GENERAL_ERROR_CATALOG["unknown-error"];
      const hasDoctor = solution?.steps?.some((step) => step.includes("doctor")) ?? false;
      assertEquals(hasDoctor, true);
    });
  });
});
