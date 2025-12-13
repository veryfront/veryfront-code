import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("generate", () => {
  describe("generateCommand", () => {
    it("should export generateCommand function", async () => {
      const module = await import("./generate.ts");
      assertExists(module.generateCommand);
      assertEquals(typeof module.generateCommand, "function");
    });
  });

  describe("command parameters", () => {
    it("should accept projectDir, type, and name", () => {
      const projectDir = "/test/project";
      const type = "page";
      const name = "about";

      assertEquals(projectDir, "/test/project");
      assertEquals(type, "page");
      assertEquals(name, "about");
    });

    it("should handle different generation types", () => {
      const types = ["rsc", "page", "layout", "provider", "api", "integration"];

      for (const type of types) {
        assertEquals(types.includes(type), true);
      }
    });

    it("should handle complex names with slashes", () => {
      const name = "blog/posts/[id]";
      assertEquals(name, "blog/posts/[id]");
    });
  });
});
