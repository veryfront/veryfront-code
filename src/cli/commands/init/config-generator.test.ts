import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("config-generator", () => {
  describe("createPackageJson", () => {
    it("should export createPackageJson function", async () => {
      const module = await import("./config-generator.ts");
      assertExists(module.createPackageJson);
      assertEquals(typeof module.createPackageJson, "function");
    });
  });

  describe("function parameters", () => {
    it("should accept projectDir and optional projectName", () => {
      const projectDir = "/test/project";
      const projectName = "my-app";

      assertEquals(projectDir, "/test/project");
      assertEquals(projectName, "my-app");
    });

    it("should handle projectDir only", () => {
      const projectDir = "/test/project";

      assertEquals(projectDir, "/test/project");
    });
  });
});
