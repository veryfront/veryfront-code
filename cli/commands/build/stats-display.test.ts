import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for build stats display
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { displayBuildSuccess } from "./stats-display.ts";
import type { BuildStats } from "./types.ts";

function captureOutput(run: () => void): string {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    run();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n");
}

describe("build/stats-display", () => {
  describe("displayBuildSuccess", () => {
    it("handles valid build stats without throwing", () => {
      const stats: BuildStats = {
        pages: 5,
        components: 15,
        chunks: 10,
        assets: 20,
        totalSize: 1024 * 1024 * 2,
        duration: 5000,
      };

      displayBuildSuccess(stats, Date.now() - 5000, "dist", false);
    });

    it("handles zero stats values (empty build)", () => {
      const stats: BuildStats = {
        pages: 0,
        components: 0,
        chunks: 0,
        assets: 0,
        totalSize: 0,
        duration: 0,
      };

      displayBuildSuccess(stats, Date.now(), "build", false);
    });

    it("handles dry run mode with SSG paths", () => {
      const stats: BuildStats = {
        pages: 3,
        components: 6,
        chunks: 5,
        assets: 8,
        totalSize: 512 * 1024,
        duration: 1000,
        ssgPaths: ["/", "/about", "/contact"],
      };

      displayBuildSuccess(stats, Date.now() - 1000, "output", true);
    });

    it("handles large totalSize values correctly", () => {
      const stats: BuildStats = {
        pages: 100,
        components: 250,
        chunks: 500,
        assets: 1000,
        totalSize: 1024 * 1024 * 100,
        duration: 60000,
      };

      displayBuildSuccess(stats, Date.now() - 60000, "dist", false);
    });

    it("handles empty ssgPaths in dry run mode", () => {
      const stats: BuildStats = {
        pages: 2,
        components: 4,
        chunks: 3,
        assets: 5,
        totalSize: 1024 * 512,
        duration: 500,
        ssgPaths: [],
      };

      displayBuildSuccess(stats, Date.now() - 500, "out", true);
    });

    it("handles very short build duration", () => {
      const stats: BuildStats = {
        pages: 1,
        components: 1,
        chunks: 1,
        assets: 1,
        totalSize: 1024,
        duration: 10,
      };

      const output = captureOutput(() => displayBuildSuccess(stats, Date.now(), "dist", false));

      assertEquals(output.includes("1 page, 1 chunk, 1 asset"), true);
      assertEquals(output.includes("1 pages"), false);
    });
  });
});
