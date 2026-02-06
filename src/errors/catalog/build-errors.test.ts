import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { BUILD_ERROR_CATALOG } from "./build-errors.ts";

describe("errors/catalog/build-errors", () => {
  describe("BUILD_ERROR_CATALOG", () => {
    it("should contain all build error slugs", () => {
      const expectedSlugs = [
        "build-failed",
        "bundle-error",
        "typescript-error",
        "mdx-compile-error",
        "asset-optimization-error",
        "ssg-generation-error",
        "sourcemap-error",
        "compilation-error",
      ];

      for (const slug of expectedSlugs) {
        assertEquals(slug in BUILD_ERROR_CATALOG, true, `Missing error slug: ${slug}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [slug, solution] of Object.entries(BUILD_ERROR_CATALOG)) {
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

    it("should have 8 entries", () => {
      assertEquals(Object.keys(BUILD_ERROR_CATALOG).length, 8);
    });

    it("build-failed should have tips", () => {
      const solution = BUILD_ERROR_CATALOG["build-failed"]!;
      assertEquals(Array.isArray(solution.tips), true);
      assertEquals((solution.tips?.length ?? 0) > 0, true);
    });

    it("mdx-compile-error should have an example", () => {
      const solution = BUILD_ERROR_CATALOG["mdx-compile-error"]!;
      assertEquals(typeof solution.example, "string");
    });
  });
});
