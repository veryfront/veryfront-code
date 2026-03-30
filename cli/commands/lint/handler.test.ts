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
    });

    it("handles invalid JSON gracefully", () => {
      const result = parseLintJsonOutput("not json", 1);
      assertEquals(result.success, false);
      assertEquals(result.diagnostics.length, 0);
    });
  });
});
