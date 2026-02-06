import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ErrorSlug } from "../error-registry.ts";
import { CONFIG_ERROR_CATALOG } from "./config-errors.ts";

function assertHasExample(slug: ErrorSlug): void {
  const solution = CONFIG_ERROR_CATALOG[slug];
  assertEquals(typeof solution?.example, "string");
}

describe("errors/catalog/config-errors", () => {
  describe("CONFIG_ERROR_CATALOG", () => {
    it("should contain all config error slugs", () => {
      const expectedSlugs = [
        "config-not-found",
        "config-invalid",
        "config-parse-error",
        "config-validation-error",
        "config-type-error",
        "import-map-invalid",
        "cors-config-invalid",
      ];

      for (const slug of expectedSlugs) {
        assertEquals(slug in CONFIG_ERROR_CATALOG, true, `Missing error slug: ${slug}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [slug, solution] of Object.entries(CONFIG_ERROR_CATALOG)) {
        assertEquals(solution.slug, slug, `slug mismatch for ${slug}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${slug}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${slug}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${slug}`);
      }
    });

    it("should have steps for all entries", () => {
      for (const [slug, solution] of Object.entries(CONFIG_ERROR_CATALOG)) {
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${slug}`);
        assertEquals(
          (solution.steps?.length ?? 0) > 0,
          true,
          `steps should not be empty for ${slug}`,
        );
      }
    });

    it("should have docs URLs pointing to veryfront.com", () => {
      for (const solution of Object.values(CONFIG_ERROR_CATALOG)) {
        assertEquals(
          solution.docs?.startsWith("https://veryfront.com/docs/errors/") ?? false,
          true,
          `docs URL should start with veryfront.com for ${solution.slug}`,
        );
      }
    });

    it("config-not-found should have example and tips", () => {
      const solution = CONFIG_ERROR_CATALOG["config-not-found"];
      assertEquals(typeof solution?.example, "string");
      assertEquals(Array.isArray(solution?.tips), true);
      assertEquals((solution?.tips?.length ?? 0) > 0, true);
    });

    it("config-invalid should have example", () => {
      assertHasExample("config-invalid");
    });

    it("import-map-invalid should have example", () => {
      assertHasExample("import-map-invalid");
    });

    it("cors-config-invalid should have example", () => {
      assertHasExample("cors-config-invalid");
    });
  });
});
