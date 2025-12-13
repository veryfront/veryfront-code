import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import type { AnalyzeChunksOptions } from "./analyze-chunks.ts";

describe("analyze-chunks", () => {
  describe("AnalyzeChunksOptions interface", () => {
    it("should define the correct structure", () => {
      const options: AnalyzeChunksOptions = {
        projectDir: "/test/project",
        output: "/test/output.json",
      };

      assertEquals(options.projectDir, "/test/project");
      assertEquals(options.output, "/test/output.json");
    });

    it("should allow output to be optional", () => {
      const options: AnalyzeChunksOptions = {
        projectDir: "/test/project",
      };

      assertEquals(options.projectDir, "/test/project");
      assertEquals(options.output, undefined);
    });
  });

  describe("analyzeChunksCommand", () => {
    it("should export the analyzeChunksCommand function", async () => {
      const module = await import("./analyze-chunks.ts");
      assertExists(module.analyzeChunksCommand);
      assertEquals(typeof module.analyzeChunksCommand, "function");
    });
  });
});
