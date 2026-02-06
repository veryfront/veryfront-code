import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleAnalyzeChunksCommand, parseAnalyzeChunksArgs } from "./handler.ts";

describe("commands/analyze-chunks/handler", () => {
  describe("handleAnalyzeChunksCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleAnalyzeChunksCommand, "function");
      assertEquals(handleAnalyzeChunksCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleAnalyzeChunksCommand.length, 1);
    });
  });

  describe("parseAnalyzeChunksArgs", () => {
    it("defaults projectDir to empty string when not provided", () => {
      const result = parseAnalyzeChunksArgs({ _: ["analyze-chunks"] });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.projectDir, "");
    });

    it("uses --project-dir string value when provided", () => {
      const result = parseAnalyzeChunksArgs({
        _: ["analyze-chunks"],
        "project-dir": "/custom/path",
      });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.projectDir, "/custom/path");
    });

    it("uses -d alias for project dir", () => {
      const result = parseAnalyzeChunksArgs({
        _: ["analyze-chunks"],
        d: "/custom/path",
      });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.projectDir, "/custom/path");
    });

    it("parses --output as string value", () => {
      const result = parseAnalyzeChunksArgs({
        _: ["analyze-chunks"],
        output: "report.json",
      });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.output, "report.json");
    });

    it("returns undefined for --output when not provided", () => {
      const result = parseAnalyzeChunksArgs({ _: ["analyze-chunks"] });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.output, undefined);
    });

    it("uses -o alias for output", () => {
      const result = parseAnalyzeChunksArgs({
        _: ["analyze-chunks"],
        o: "report.json",
      });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.output, "report.json");
    });

    it("accepts output path with directory separators", () => {
      const result = parseAnalyzeChunksArgs({
        _: ["analyze-chunks"],
        output: "./reports/chunks.json",
      });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.output, "./reports/chunks.json");
    });
  });
});
