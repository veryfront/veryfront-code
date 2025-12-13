import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("project-structure", () => {
  describe("checkProjectStructure", () => {
    it("should export checkProjectStructure function", async () => {
      const module = await import("./project-structure.ts");
      assertExists(module.checkProjectStructure);
      assertEquals(typeof module.checkProjectStructure, "function");
    });
  });

  describe("checkConfiguration", () => {
    it("should export checkConfiguration function", async () => {
      const module = await import("./project-structure.ts");
      assertExists(module.checkConfiguration);
      assertEquals(typeof module.checkConfiguration, "function");
    });
  });

  describe("checkCacheSystem", () => {
    it("should export checkCacheSystem function", async () => {
      const module = await import("./project-structure.ts");
      assertExists(module.checkCacheSystem);
      assertEquals(typeof module.checkCacheSystem, "function");
    });

    it("should return a successful diagnostic result", async () => {
      const module = await import("./project-structure.ts");
      const result = await module.checkCacheSystem();

      assertExists(result);
      assertEquals(result.name, "Cache System");
      assertEquals(result.status, "pass");
      assertExists(result.message);
    });
  });
});
