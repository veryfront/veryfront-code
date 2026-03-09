import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CorsHandler } from "./cors.ts";

describe("server/handlers/response/cors", () => {
  describe("CorsHandler metadata", () => {
    it("should have correct handler name", () => {
      const handler = new CorsHandler();
      assertEquals(handler.metadata.name, "CorsHandler");
    });

    it("should have a pattern defined", () => {
      const handler = new CorsHandler();
      assertExists(handler.metadata.patterns);
      assertEquals(handler.metadata.patterns!.length, 1);
    });

    it("should match OPTIONS method only", () => {
      const handler = new CorsHandler();
      const patterns = handler.metadata.patterns;
      assertExists(patterns);
      const pattern = patterns[0];
      assertEquals(typeof pattern !== "string", true);
      if (typeof pattern !== "string") {
        assertEquals((pattern as { method?: string }).method, "OPTIONS");
      }
    });

    it("should match all paths (catch-all pattern)", () => {
      const handler = new CorsHandler();
      const patterns = handler.metadata.patterns;
      assertExists(patterns);
      const pattern = patterns[0];
      if (typeof pattern !== "string") {
        const p = (pattern as { pattern: RegExp }).pattern;
        assertEquals(p instanceof RegExp, true);
        assertEquals(p.test("/any/path"), true);
        assertEquals(p.test("/"), true);
        assertEquals(p.test("/api/users"), true);
      }
    });
  });
});
