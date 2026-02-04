/**
 * Tests for build config display
 */

import { describe, it } from "#veryfront/testing/bdd.ts";
import { displayBuildConfig, displayBuildStart } from "./config-display.ts";
import type { BuildOptions } from "./types.ts";

describe("build/config-display", () => {
  describe("displayBuildConfig", () => {
    it("handles minimal options (only projectDir)", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
      };

      displayBuildConfig(options);
    });

    it("handles all features enabled", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        outputDir: "build",
        splitting: true,
        compress: true,
        prefetch: true,
        ssg: true,
        dryRun: false,
      };

      displayBuildConfig(options);
    });

    it("handles all features disabled", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        outputDir: "dist",
        splitting: false,
        compress: false,
        prefetch: false,
        ssg: false,
        dryRun: false,
      };

      displayBuildConfig(options);
    });

    it("handles dry run mode", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        dryRun: true,
      };

      displayBuildConfig(options);
    });

    it("handles include patterns", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        include: ["pages/**", "app/**"],
      };

      displayBuildConfig(options);
    });

    it("handles exclude patterns", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        exclude: ["**/*.test.ts", "**/__tests__/**"],
      };

      displayBuildConfig(options);
    });

    it("handles both include and exclude patterns", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        include: ["src/**"],
        exclude: ["src/tests/**"],
      };

      displayBuildConfig(options);
    });

    it("handles empty include/exclude arrays", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        include: [],
        exclude: [],
      };

      displayBuildConfig(options);
    });
  });

  describe("displayBuildStart", () => {
    it("executes without error", () => {
      displayBuildStart();
    });
  });
});
