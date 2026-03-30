import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseTestOutput } from "./command.ts";

describe("Test Command", () => {
  describe("parseTestOutput", () => {
    it("parses successful deno test output", () => {
      const output = "ok | 10 passed | 0 failed (1.5s)";
      const result = parseTestOutput(output, 0);
      assertEquals(result.success, true);
      assertEquals(result.summary.passed, 10);
      assertEquals(result.summary.failed, 0);
    });

    it("parses failed deno test output", () => {
      const output = "FAILED | 8 passed | 2 failed (2.1s)";
      const result = parseTestOutput(output, 1);
      assertEquals(result.success, false);
      assertEquals(result.summary.failed, 2);
    });
  });
});
