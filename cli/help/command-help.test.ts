/**
 * Tests for command help display
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { showCommandHelp } from "./command-help.ts";

function captureConsoleLog(run: () => void): string {
  const output: string[] = [];
  const originalLog = console.log;

  try {
    console.log = (msg?: unknown, ...rest: unknown[]) => {
      output.push(String(msg), ...rest.map(String));
    };
    run();
  } finally {
    console.log = originalLog;
  }

  return output.join("\n");
}

describe("command-help", () => {
  describe("showCommandHelp", () => {
    it("is a function", () => {
      assertEquals(typeof showCommandHelp, "function");
    });

    it("renders notes when available", () => {
      const output = captureConsoleLog(() => showCommandHelp("start"));
      assertStringIncludes(output, "Notes:");
      assertStringIncludes(output, "Single project");
      assertStringIncludes(output, "Workspace");
    });
  });
});
