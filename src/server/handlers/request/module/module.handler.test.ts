import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ModuleHandler } from "./module.handler.ts";

describe("server/handlers/request/module/module.handler", () => {
  describe("metadata", () => {
    it("should have correct handler name", () => {
      const handler = new ModuleHandler();
      assertEquals(handler.metadata.name, "ModuleHandler");
    });

    it("should have patterns for all module prefixes", () => {
      const handler = new ModuleHandler();
      const patterns = handler.metadata.patterns;
      assertExists(patterns);

      const patternStrings = patterns.map((p) =>
        typeof p === "string" ? p : (p as { pattern: string }).pattern
      );

      assertEquals(patternStrings.includes("/_vf_modules/"), true);
      assertEquals(patternStrings.includes("/_veryfront/modules/"), true);
      assertEquals(patternStrings.includes("/_veryfront/pages/"), true);
      assertEquals(patternStrings.includes("/_veryfront/data/"), true);
      assertEquals(patternStrings.includes("/_veryfront/page-data/"), true);
    });

    it("should have all patterns marked as prefix", () => {
      const handler = new ModuleHandler();
      const patterns = handler.metadata.patterns;
      assertExists(patterns);

      for (const pattern of patterns) {
        if (typeof pattern === "string") continue;
        assertEquals((pattern as { prefix?: boolean }).prefix, true);
      }
    });

    it("should have 5 patterns total", () => {
      const handler = new ModuleHandler();
      assertEquals(handler.metadata.patterns?.length, 5);
    });
  });
});
