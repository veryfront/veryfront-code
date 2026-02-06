import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEV_ERROR_CATALOG } from "./dev-errors.ts";

describe("errors/catalog/dev-errors", () => {
  describe("DEV_ERROR_CATALOG", () => {
    it("should contain all dev error slugs", () => {
      const expectedSlugs = [
        "dev-server-error",
        "fast-refresh-error",
        "error-overlay-error",
        "source-map-error",
      ];

      for (const slug of expectedSlugs) {
        assertEquals(slug in DEV_ERROR_CATALOG, true, `Missing error slug: ${slug}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [slug, solution] of Object.entries(DEV_ERROR_CATALOG)) {
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

    it("should have 4 entries", () => {
      assertEquals(Object.keys(DEV_ERROR_CATALOG).length, 4);
    });

    it("dev-server-error should suggest restarting dev server", () => {
      const solution = DEV_ERROR_CATALOG["dev-server-error"]!;
      const hasRestart = solution.steps!.some((step) => step.toLowerCase().includes("restart"));
      assertEquals(hasRestart, true);
    });
  });
});
