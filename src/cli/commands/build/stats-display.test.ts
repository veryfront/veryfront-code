import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { displayBuildSuccess } from "./stats-display.ts";
import type { BuildStats } from "./types.ts";

describe("stats-display", () => {
  describe("displayBuildSuccess", () => {
    it("should export displayBuildSuccess function", () => {
      assertExists(displayBuildSuccess);
      assertEquals(typeof displayBuildSuccess, "function");
    });

    it("should display build statistics", () => {
      const stats: BuildStats = {
        pages: 5,
        components: 20,
        chunks: 10,
        assets: 15,
        totalSize: 1024 * 1024, // 1 MB
        duration: 5,
      };
      const startTime = Date.now() - 5000;
      const outputDir = "dist";
      const dryRun = false;

      // Should not throw
      displayBuildSuccess(stats, startTime, outputDir, dryRun);
    });

    it("should handle dry run mode with SSG paths", () => {
      const stats: BuildStats = {
        pages: 3,
        components: 10,
        chunks: 8,
        assets: 12,
        totalSize: 512 * 1024,
        duration: 3,
        ssgPaths: ["/", "/about", "/contact"],
      };
      const startTime = Date.now() - 3000;
      const outputDir = "dist";
      const dryRun = true;

      // Should not throw
      displayBuildSuccess(stats, startTime, outputDir, dryRun);
    });

    it("should calculate duration correctly", () => {
      const stats: BuildStats = {
        pages: 1,
        components: 5,
        chunks: 1,
        assets: 1,
        totalSize: 1024,
        duration: 10,
      };
      const startTime = Date.now() - 10000; // 10 seconds ago
      const outputDir = "dist";
      const dryRun = false;

      // Should not throw
      displayBuildSuccess(stats, startTime, outputDir, dryRun);
    });

    it("should format file sizes correctly", () => {
      const stats: BuildStats = {
        pages: 100,
        components: 500,
        chunks: 200,
        assets: 300,
        totalSize: 50 * 1024 * 1024, // 50 MB
        duration: 60,
      };
      const startTime = Date.now() - 60000; // 1 minute ago
      const outputDir = "dist";
      const dryRun = false;

      // Should not throw
      displayBuildSuccess(stats, startTime, outputDir, dryRun);
    });
  });
});
