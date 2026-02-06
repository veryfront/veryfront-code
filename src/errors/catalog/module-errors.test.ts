import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MODULE_ERROR_CATALOG } from "./module-errors.ts";

describe("errors/catalog/module-errors", () => {
  describe("MODULE_ERROR_CATALOG", () => {
    it("should contain all module error slugs", () => {
      const expectedSlugs = [
        "cache-path-mismatch",
        "module-not-found",
        "import-resolution-error",
        "circular-dependency",
        "invalid-import",
        "dependency-missing",
        "version-mismatch",
      ];

      for (const slug of expectedSlugs) {
        assertEquals(slug in MODULE_ERROR_CATALOG, true, `Missing error slug: ${slug}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [slug, solution] of Object.entries(MODULE_ERROR_CATALOG)) {
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

    it("should have 7 entries", () => {
      assertEquals(Object.keys(MODULE_ERROR_CATALOG).length, 7);
    });

    it("cache-path-mismatch should have an example with curl command", () => {
      const solution = MODULE_ERROR_CATALOG["cache-path-mismatch"];
      assertEquals(typeof solution?.example, "string");
      assertEquals(solution?.example?.includes("curl"), true);
    });

    it("module-not-found should have an example with import map", () => {
      const solution = MODULE_ERROR_CATALOG["module-not-found"];
      assertEquals(typeof solution?.example, "string");
      assertEquals(solution?.example?.includes("importMap"), true);
    });

    it("dependency-missing should have an example", () => {
      const solution = MODULE_ERROR_CATALOG["dependency-missing"];
      assertEquals(typeof solution?.example, "string");
      assertEquals(solution?.example?.includes("react"), true);
    });
  });
});
