import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP run-lint tool
 */

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseLintJsonOutput } from "../../commands/lint/command.ts";
import { executeLint, vfRunLint } from "./run-lint-tool.ts";

// ---------------------------------------------------------------------------
// Tool definition (shape)
// ---------------------------------------------------------------------------

describe("mcp/tools/run-lint-tool", () => {
  describe("vfRunLint tool definition", () => {
    it("has correct tool name", () => {
      assertEquals(vfRunLint.name, "vf_run_lint");
    });

    it("has description mentioning lint", () => {
      assertExists(vfRunLint.description);
      assertEquals(vfRunLint.description.toLowerCase().includes("lint"), true);
    });

    it("has description cross-referencing vf_run_tests", () => {
      assertEquals(vfRunLint.description.includes("vf_run_tests"), true);
    });

    it("has description cross-referencing vf_get_errors", () => {
      assertEquals(vfRunLint.description.includes("vf_get_errors"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfRunLint.execute, "function");
    });

    it("has correct annotations — read-only, not destructive", () => {
      assertEquals(vfRunLint.annotations?.readOnlyHint, true);
      assertEquals(vfRunLint.annotations?.destructiveHint, false);
      assertEquals(vfRunLint.annotations?.idempotentHint, true);
      assertEquals(vfRunLint.annotations?.openWorldHint, false);
    });

    it("has title", () => {
      assertEquals(vfRunLint.title, "Run Lint");
    });
  });

  // ---------------------------------------------------------------------------
  // parseLintJsonOutput (validates the parser the tool depends on)
  // ---------------------------------------------------------------------------

  describe("parseLintJsonOutput integration", () => {
    it("parses clean lint output with no diagnostics", () => {
      const output = JSON.stringify({ diagnostics: [] });
      const result = parseLintJsonOutput(output, 0);
      assertEquals(result.success, true);
      assertEquals(result.diagnostics.length, 0);
      assertEquals(result.summary.total, 0);
      assertEquals(result.summary.files_checked, 0);
    });

    it("parses lint output with diagnostics", () => {
      const output = JSON.stringify({
        diagnostics: [
          {
            filename: "src/app.ts",
            range: { start: { line: 10, col: 5 } },
            code: "no-unused-vars",
            message: "'x' is declared but never used",
          },
          {
            filename: "src/utils.ts",
            range: { start: { line: 3, col: 1 } },
            code: "no-explicit-any",
            message: "Unexpected any. Specify a different type.",
          },
        ],
      });
      const result = parseLintJsonOutput(output, 1);
      assertEquals(result.success, false);
      assertEquals(result.diagnostics.length, 2);
      assertEquals(result.summary.total, 2);
      assertEquals(result.summary.files_checked, 2);

      assertEquals(result.diagnostics[0].file, "src/app.ts");
      assertEquals(result.diagnostics[0].line, 10);
      assertEquals(result.diagnostics[0].col, 5);
      assertEquals(result.diagnostics[0].code, "no-unused-vars");
      assertEquals(result.diagnostics[0].message, "'x' is declared but never used");

      assertEquals(result.diagnostics[1].file, "src/utils.ts");
    });

    it("counts unique files correctly when multiple diagnostics in same file", () => {
      const output = JSON.stringify({
        diagnostics: [
          {
            filename: "src/app.ts",
            range: { start: { line: 1, col: 1 } },
            code: "no-unused-vars",
            message: "a",
          },
          {
            filename: "src/app.ts",
            range: { start: { line: 5, col: 1 } },
            code: "no-explicit-any",
            message: "b",
          },
          {
            filename: "src/other.ts",
            range: { start: { line: 1, col: 1 } },
            code: "no-unused-vars",
            message: "c",
          },
        ],
      });
      const result = parseLintJsonOutput(output, 1);
      assertEquals(result.summary.total, 3);
      assertEquals(result.summary.files_checked, 2);
    });

    it("handles empty output gracefully", () => {
      const result = parseLintJsonOutput("", 0);
      assertEquals(result.success, true);
      assertEquals(result.diagnostics.length, 0);
    });

    it("handles invalid JSON gracefully", () => {
      const result = parseLintJsonOutput("not json at all", 1);
      assertEquals(result.success, false);
      assertEquals(result.diagnostics.length, 0);
    });

    it("handles missing fields in diagnostics gracefully", () => {
      const output = JSON.stringify({
        diagnostics: [{ filename: "foo.ts" }],
      });
      const result = parseLintJsonOutput(output, 1);
      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0].file, "foo.ts");
      assertEquals(result.diagnostics[0].line, 0);
      assertEquals(result.diagnostics[0].col, 0);
      assertEquals(result.diagnostics[0].code, "");
      assertEquals(result.diagnostics[0].message, "");
    });
  });

  // ---------------------------------------------------------------------------
  // executeLint timeout
  // ---------------------------------------------------------------------------

  describe("executeLint", () => {
    it("rejects on timeout", async () => {
      await assertRejects(
        () => executeLint({ timeout: 1 }),
        Error,
        "timed out",
      );
    });
  });
});
