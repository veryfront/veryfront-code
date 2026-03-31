import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseLintJsonOutput } from "./command.ts";

describe("Lint Command", () => {
  describe("parseLintJsonOutput", () => {
    it("parses successful lint output", () => {
      const output = JSON.stringify({ diagnostics: [] });
      const result = parseLintJsonOutput(output, 0);
      assertEquals(result.success, true);
      assertEquals(result.diagnostics.length, 0);
      assertEquals(result.summary.total, 0);
    });

    it("parses lint output with diagnostics", () => {
      const output = JSON.stringify({
        diagnostics: [
          {
            filename: "test.ts",
            range: { start: { line: 1, col: 5 } },
            code: "no-unused-vars",
            message: "Unused variable",
          },
        ],
      });
      const result = parseLintJsonOutput(output, 1);
      assertEquals(result.success, false);
      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0].code, "no-unused-vars");
      assertEquals(result.diagnostics[0].file, "test.ts");
      assertEquals(result.diagnostics[0].line, 1);
      assertEquals(result.diagnostics[0].col, 5);
    });

    it("handles invalid JSON gracefully", () => {
      const result = parseLintJsonOutput("not json", 1);
      assertEquals(result.success, false);
      assertEquals(result.diagnostics.length, 0);
    });

    it("handles empty string gracefully", () => {
      const result = parseLintJsonOutput("", 0);
      assertEquals(result.success, true);
      assertEquals(result.diagnostics.length, 0);
    });

    it("counts unique files in summary", () => {
      const output = JSON.stringify({
        diagnostics: [
          {
            filename: "a.ts",
            range: { start: { line: 1, col: 1 } },
            code: "rule1",
            message: "msg1",
          },
          {
            filename: "a.ts",
            range: { start: { line: 5, col: 1 } },
            code: "rule2",
            message: "msg2",
          },
          {
            filename: "b.ts",
            range: { start: { line: 1, col: 1 } },
            code: "rule1",
            message: "msg3",
          },
        ],
      });
      const result = parseLintJsonOutput(output, 1);
      assertEquals(result.summary.total, 3);
      assertEquals(result.summary.files_checked, 2);
    });

    it("handles diagnostics with missing fields", () => {
      const output = JSON.stringify({
        diagnostics: [
          { code: "test-rule", message: "missing range and filename" },
        ],
      });
      const result = parseLintJsonOutput(output, 1);
      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0].file, "");
      assertEquals(result.diagnostics[0].line, 0);
      assertEquals(result.diagnostics[0].col, 0);
    });

    it("success is determined by exit code", () => {
      const output = JSON.stringify({ diagnostics: [] });
      assertEquals(parseLintJsonOutput(output, 0).success, true);
      assertEquals(parseLintJsonOutput(output, 1).success, false);
    });
  });
});
