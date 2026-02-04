/**
 * Tests for build stats display
 */

import "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { displayBuildSuccess } from "./stats-display.ts";
import type { BuildStats } from "./types.ts";

describe("build/stats-display", () => {
  describe("displayBuildSuccess", () => {
    it("handles valid build stats without throwing", () => {
      const stats: BuildStats = {
        pages: 5,
        chunks: 10,
        assets: 20,
        totalSize: 1024 * 1024 * 2,
      };

      displayBuildSuccess(stats, Date.now() - 5000, "dist", false);
    });

    it("handles zero stats values (empty build)", () => {
      const stats: BuildStats = {
        pages: 0,
        chunks: 0,
        assets: 0,
        totalSize: 0,
      };

      displayBuildSuccess(stats, Date.now(), "build", false);
    });

    it("handles dry run mode with SSG paths", () => {
      const stats: BuildStats = {
        pages: 3,
        chunks: 5,
        assets: 8,
        totalSize: 512 * 1024,
        ssgPaths: ["/", "/about", "/contact"],
      };

      displayBuildSuccess(stats, Date.now() - 1000, "output", true);
    });

    it("handles large totalSize values correctly", () => {
      const stats: BuildStats = {
        pages: 100,
        chunks: 500,
        assets: 1000,
        totalSize: 1024 * 1024 * 100,
      };

      displayBuildSuccess(stats, Date.now() - 60000, "dist", false);
    });

    it("handles empty ssgPaths in dry run mode", () => {
      const stats: BuildStats = {
        pages: 2,
        chunks: 3,
        assets: 5,
        totalSize: 1024 * 512,
        ssgPaths: [],
      };

      displayBuildSuccess(stats, Date.now() - 500, "out", true);
    });

    it("handles very short build duration", () => {
      const stats: BuildStats = {
        pages: 1,
        chunks: 1,
        assets: 1,
        totalSize: 1024,
      };

      displayBuildSuccess(stats, Date.now(), "dist", false);
    });
  });
});
