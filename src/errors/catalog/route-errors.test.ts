import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildErrorDocsUrl } from "../diagnostic-policy.ts";
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
        assertEquals(
          solution.title.trim().length > 0,
          true,
          `title must be non-empty copy for ${slug}`,
        );
        assertEquals(
          solution.message.trim().length > 0,
          true,
          `message must be non-empty copy for ${slug}`,
        );
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
        assertEquals(
          solution.steps?.every((step) => step.trim().length > 0) ?? false,
          true,
          `every step must be non-empty for ${slug}`,
        );
      }
    });

    it("should have 6 entries", () => {
      assertEquals(Object.keys(ROUTE_ERROR_CATALOG).length, 6);
    });

    it("invalid-route-file should have an example", () => {
      const solution = ROUTE_ERROR_CATALOG["invalid-route-file"]!;
      assertEquals(typeof solution.example, "string");
      const example = solution.example ?? "";
      assertStringIncludes(example, "export", "example must show an exported handler");
      assertStringIncludes(example, "GET(", "example must show a GET handler signature");
      assertStringIncludes(
        example,
        "Response",
        "example must show the handler returning a Response",
      );
      assertEquals(
        example.split("\n").length > 1,
        true,
        "example must be a multi-line snippet",
      );
    });
  });
});
