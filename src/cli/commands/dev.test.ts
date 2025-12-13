import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import type { DevOptions, DevCommandOptions } from "./dev.ts";

describe("dev", () => {
  describe("devCommand", () => {
    it("should export devCommand function", async () => {
      const module = await import("./dev.ts");
      assertExists(module.devCommand);
      assertEquals(typeof module.devCommand, "function");
    });
  });

  describe("DevOptions interface", () => {
    it("should define the correct structure", () => {
      const options: DevOptions = {
        port: 3000,
        projectDir: "/test/project",
        hmr: true,
      };

      assertEquals(options.port, 3000);
      assertEquals(options.projectDir, "/test/project");
      assertEquals(options.hmr, true);
    });

    it("should allow hmr to be optional", () => {
      const options: DevOptions = {
        port: 3000,
        projectDir: "/test/project",
      };

      assertEquals(options.port, 3000);
      assertEquals(options.projectDir, "/test/project");
      assertEquals(options.hmr, undefined);
    });

    it("should have DevCommandOptions as alias", () => {
      const options: DevCommandOptions = {
        port: 8080,
        projectDir: "/test/project",
        hmr: false,
      };

      assertEquals(options.port, 8080);
      assertEquals(options.hmr, false);
    });
  });
});
