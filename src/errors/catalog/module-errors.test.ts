import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildErrorDocsUrl } from "../diagnostic-policy.ts";
import { MODULE_ERROR_CATALOG } from "./module-errors.ts";

describe("errors/catalog/module-errors", () => {
  describe("MODULE_ERROR_CATALOG", () => {
    it("should contain all module error slugs", () => {
      const expectedSlugs = [
        "module-not-found",
        "import-resolution-error",
        "circular-dependency",
        "invalid-import",
        "dependency-missing",
        "version-mismatch",
        "lockfile-format-mismatch",
        "lockfile-read-error",
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
        assertEquals(
          solution.docs,
          buildErrorDocsUrl(slug),
          `docs URL must be the canonical errors anchor for ${slug}`,
        );
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${slug}`);
        assertEquals(
          (solution.steps?.length ?? 0) > 0,
          true,
          `steps should not be empty for ${slug}`,
        );
      }
    });

    it("should have 8 entries", () => {
      assertEquals(Object.keys(MODULE_ERROR_CATALOG).length, 8);
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

    it("lockfile recovery guidance should use the supported clear command", () => {
      for (const slug of ["lockfile-format-mismatch", "lockfile-read-error"] as const) {
        const solution = MODULE_ERROR_CATALOG[slug];
        assertEquals(
          solution?.steps?.some((step) => step.includes("veryfront lock --clear")),
          true,
          `${slug} should point to the supported destructive recovery command`,
        );
      }
    });
  });
});
