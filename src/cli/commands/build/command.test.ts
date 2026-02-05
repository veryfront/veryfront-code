import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildCommand } from "./command.ts";
import type { BuildOptions } from "./types.ts";

describe("commands/build/command", () => {
  describe("buildCommand", () => {
    it("is exported as a function", () => {
      assertExists(buildCommand);
      assertEquals(typeof buildCommand, "function");
    });

    it("accepts a single BuildOptions parameter", () => {
      assertEquals(buildCommand.length, 1);
    });
  });

  describe("BuildOptions interface", () => {
    it("supports required projectDir field", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
      };
      assertEquals(options.projectDir, "/path/to/project");
    });

    it("supports optional outputDir", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        outputDir: "/path/to/dist",
      };
      assertEquals(options.outputDir, "/path/to/dist");
    });

    it("supports splitting option", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        splitting: true,
      };
      assertEquals(options.splitting, true);
    });

    it("supports compress option", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        compress: true,
      };
      assertEquals(options.compress, true);
    });

    it("supports prefetch option", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        prefetch: false,
      };
      assertEquals(options.prefetch, false);
    });

    it("supports ssg option", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        ssg: true,
      };
      assertEquals(options.ssg, true);
    });

    it("supports dryRun option", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        dryRun: true,
      };
      assertEquals(options.dryRun, true);
    });

    it("supports include and exclude patterns", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        include: ["pages/**", "app/**"],
        exclude: ["**/*.test.ts"],
      };
      assertEquals(options.include, ["pages/**", "app/**"]);
      assertEquals(options.exclude, ["**/*.test.ts"]);
    });
  });

  describe("re-export via index.ts", () => {
    it("buildCommand is available from index", async () => {
      const mod = await import("./index.ts");
      assertExists(mod.buildCommand);
      assertEquals(typeof mod.buildCommand, "function");
    });

    it("handleBuildCommand is available from index", async () => {
      const mod = await import("./index.ts");
      assertExists(mod.handleBuildCommand);
      assertEquals(typeof mod.handleBuildCommand, "function");
    });
  });
});
