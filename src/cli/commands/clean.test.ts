import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("clean", () => {
  describe("cleanCommand", () => {
    it("should export cleanCommand function", async () => {
      const module = await import("./clean.ts");
      assertExists(module.cleanCommand);
      assertEquals(typeof module.cleanCommand, "function");
    });
  });

  describe("CleanOptions interface", () => {
    it("should accept valid clean options", () => {
      const options = {
        projectDir: "/test/project",
        cache: true,
        build: true,
        all: false,
        force: false,
      };

      assertEquals(options.projectDir, "/test/project");
      assertEquals(options.cache, true);
      assertEquals(options.build, true);
      assertEquals(options.all, false);
      assertEquals(options.force, false);
    });

    it("should handle optional properties", () => {
      const options = {
        projectDir: "/test/project",
      };

      assertEquals(options.projectDir, "/test/project");
    });

    it("should handle all clean mode", () => {
      const options = {
        projectDir: "/test/project",
        all: true,
        force: true,
      };

      assertEquals(options.all, true);
      assertEquals(options.force, true);
    });
  });
});
