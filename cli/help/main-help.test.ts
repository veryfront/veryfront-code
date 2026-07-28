import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for main help display
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { showMainHelp } from "./main-help.ts";

describe("main-help", () => {
  describe("showMainHelp", () => {
    it("is a function", () => {
      assertEquals(typeof showMainHelp, "function");
    });

    it("documents the non-interactive mode", () => {
      const originalLog = console.log;
      const lines: string[] = [];
      console.log = (...args: unknown[]) => lines.push(args.join(" "));
      try {
        showMainHelp();
      } finally {
        console.log = originalLog;
      }

      const output = lines.join("\n");
      assertEquals(output.includes("--no-input"), true);
      assertEquals(output.includes("--no-color"), true);
      assertEquals(output.includes("--no-animation"), true);
      assertEquals(output.includes("--verbose"), true);
      assertEquals(output.includes("--quiet"), true);
      assertEquals(
        lines.find((line) => line.trimStart().startsWith("Docs:"))?.trim(),
        "Docs:    https://veryfront.com/docs",
      );
      assertEquals(
        lines.find((line) => line.trimStart().startsWith("Support:"))?.trim(),
        "Support: https://github.com/veryfront/veryfront-code/issues",
      );
    });
  });
});
