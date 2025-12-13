import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { displayBuildConfig, displayBuildStart } from "./config-display.ts";

describe("config-display", () => {
  describe("displayBuildConfig", () => {
    it("should export displayBuildConfig function", () => {
      assertExists(displayBuildConfig);
      assertEquals(typeof displayBuildConfig, "function");
    });

    it("should accept valid BuildOptions", () => {
      const options = {
        projectDir: "/test/project",
        outputDir: "dist",
        splitting: true,
        compress: true,
        prefetch: true,
        ssg: true,
        dryRun: false,
      };

      // Should not throw
      displayBuildConfig(options);
    });

    it("should handle optional outputDir", () => {
      const options = {
        projectDir: "/test/project",
      };

      // Should not throw
      displayBuildConfig(options);
    });

    it("should handle include and exclude arrays", () => {
      const options = {
        projectDir: "/test/project",
        include: ["pages/**"],
        exclude: ["**/*.test.ts"],
      };

      // Should not throw
      displayBuildConfig(options);
    });

    it("should display dry run mode", () => {
      const options = {
        projectDir: "/test/project",
        dryRun: true,
      };

      // Should not throw
      displayBuildConfig(options);
    });
  });

  describe("displayBuildStart", () => {
    it("should export displayBuildStart function", () => {
      assertExists(displayBuildStart);
      assertEquals(typeof displayBuildStart, "function");
    });

    it("should execute without errors", () => {
      // Should not throw
      displayBuildStart();
    });
  });
});
