import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleAnalyzeChunksCommand } from "./handler.ts";
import type { ParsedArgs } from "../../shared/types.ts";

function extractAnalyzeChunksArgs(args: ParsedArgs, cwdVal: string) {
  const projectDir = typeof args.project === "string" ? args.project : cwdVal;
  const output = typeof args.output === "string" ? args.output : undefined;
  return {
    projectDir,
    output,
  };
}

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

  describe("argument extraction", () => {
    const CWD = "/home/user/project";

    it("uses cwd when no --project flag provided", () => {
      const result = extractAnalyzeChunksArgs({ _: ["analyze-chunks"] }, CWD);
      assertEquals(result.projectDir, CWD);
    });

    it("uses --project string value when provided", () => {
      const result = extractAnalyzeChunksArgs(
        { _: ["analyze-chunks"], project: "/custom/path" },
        CWD,
      );
      assertEquals(result.projectDir, "/custom/path");
    });

    it("falls back to cwd when --project is non-string (boolean true)", () => {
      const result = extractAnalyzeChunksArgs({ _: ["analyze-chunks"], project: true }, CWD);
      assertEquals(result.projectDir, CWD);
    });

    it("parses --output as string value", () => {
      const result = extractAnalyzeChunksArgs(
        { _: ["analyze-chunks"], output: "report.json" },
        CWD,
      );
      assertEquals(result.output, "report.json");
    });

    it("returns undefined for --output when not provided", () => {
      const result = extractAnalyzeChunksArgs({ _: ["analyze-chunks"] }, CWD);
      assertEquals(result.output, undefined);
    });

    it("returns undefined for --output when value is boolean (flag without value)", () => {
      const result = extractAnalyzeChunksArgs({ _: ["analyze-chunks"], output: true }, CWD);
      assertEquals(result.output, undefined);
    });

    it("returns undefined for --output when value is a number", () => {
      const result = extractAnalyzeChunksArgs({ _: ["analyze-chunks"], output: 42 }, CWD);
      assertEquals(result.output, undefined);
    });

    it("accepts output path with directory separators", () => {
      const result = extractAnalyzeChunksArgs(
        { _: ["analyze-chunks"], output: "./reports/chunks.json" },
        CWD,
      );
      assertEquals(result.output, "./reports/chunks.json");
    });
  });
});
