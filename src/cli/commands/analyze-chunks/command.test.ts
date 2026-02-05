/**
 * Tests for analyze-chunks command
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { analyzeChunksCommand, type AnalyzeChunksOptions } from "./index.ts";

describe("analyze-chunks command", () => {
  describe("analyzeChunksCommand", () => {
    it("is a function", () => {
      assertEquals(typeof analyzeChunksCommand, "function");
    });

    it("accepts options with projectDir", () => {
      assertEquals(analyzeChunksCommand.length, 1);
    });

    it("AnalyzeChunksOptions interface has expected shape", () => {
      const options: AnalyzeChunksOptions = {
        projectDir: "/test/project",
        output: "analysis.json",
      };

      assertEquals(options.projectDir, "/test/project");
      assertEquals(options.output, "analysis.json");
    });
  });
});
