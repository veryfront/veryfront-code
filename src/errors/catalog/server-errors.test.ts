import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SERVER_ERROR_CATALOG } from "./server-errors.ts";

describe("errors/catalog/server-errors", () => {
  describe("SERVER_ERROR_CATALOG", () => {
    it("should contain all server error slugs", () => {
      const expectedSlugs = [
        "port-in-use",
        "server-start-error",
        "hmr-error",
        "cache-error",
        "file-watch-error",
        "request-error",
        "service-overloaded",
        "network-error",
      ];

      for (const slug of expectedSlugs) {
        assertEquals(slug in SERVER_ERROR_CATALOG, true, `Missing error slug: ${slug}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [slug, solution] of Object.entries(SERVER_ERROR_CATALOG)) {
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
      assertEquals(Object.keys(SERVER_ERROR_CATALOG).length, 8);
    });

    it("port-in-use should have an example", () => {
      const solution = SERVER_ERROR_CATALOG["port-in-use"]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(solution.example?.includes("port") ?? false, true);
    });
  });
});
