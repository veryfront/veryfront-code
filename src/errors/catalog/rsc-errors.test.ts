import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RSC_ERROR_CATALOG } from "./rsc-errors.ts";

describe("errors/catalog/rsc-errors", () => {
  describe("RSC_ERROR_CATALOG", () => {
    it("should contain all RSC error slugs", () => {
      const expectedSlugs = [
        "client-boundary-violation",
        "server-only-in-client",
        "client-only-in-server",
        "invalid-use-client",
        "invalid-use-server",
        "rsc-payload-error",
      ];

      for (const slug of expectedSlugs) {
        assertEquals(slug in RSC_ERROR_CATALOG, true, `Missing error slug: ${slug}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [slug, solution] of Object.entries(RSC_ERROR_CATALOG)) {
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
      assertEquals(Object.keys(RSC_ERROR_CATALOG).length, 6);
    });

    it("client-boundary-violation should have an example", () => {
      const solution = RSC_ERROR_CATALOG["client-boundary-violation"]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(solution.example?.includes("use client") ?? false, true);
    });

    it("invalid-use-client should have an example", () => {
      const solution = RSC_ERROR_CATALOG["invalid-use-client"]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(solution.example?.includes("use client") ?? false, true);
    });
  });
});
