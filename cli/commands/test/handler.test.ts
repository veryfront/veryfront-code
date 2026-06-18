import "#veryfront/schemas/_test-setup.ts";
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
      assertEquals(result.summary.duration_ms, 1500);
    });

    it("parses failed deno test output", () => {
      const output = "FAILED | 8 passed | 2 failed (2.1s)";
      const result = parseTestOutput(output, 1);
      assertEquals(result.success, false);
      assertEquals(result.summary.passed, 8);
      assertEquals(result.summary.failed, 2);
    });

    it("parses skipped/ignored tests", () => {
      const output = "ok | 5 passed | 0 failed | 3 ignored (0.5s)";
      const result = parseTestOutput(output, 0);
      assertEquals(result.summary.skipped, 3);
      assertEquals(result.summary.total, 8);
    });

    it("calculates total from passed + failed + skipped", () => {
      const output = "FAILED | 7 passed | 1 failed | 2 ignored (3s)";
      const result = parseTestOutput(output, 1);
      assertEquals(result.summary.total, 10);
    });

    it("handles empty output", () => {
      const result = parseTestOutput("", 0);
      assertEquals(result.success, true);
      assertEquals(result.summary.passed, 0);
      assertEquals(result.summary.failed, 0);
      assertEquals(result.summary.total, 0);
      assertEquals(result.failures.length, 0);
    });

    it("treats a project with no test modules as a successful empty run", () => {
      const result = parseTestOutput("error: No test modules found", 1);
      assertEquals(result.success, true);
      assertEquals(result.summary.total, 0);
      assertEquals(result.summary.passed, 0);
      assertEquals(result.summary.failed, 0);
      assertEquals(result.failures.length, 0);
    });

    it("extracts failure details", () => {
      const output = [
        "my test ... FAILED",
        "  at file:///src/test.ts:42",
        "  AssertionError: Values are not equal",
        "",
        "FAILED | 0 passed | 1 failed (0.1s)",
      ].join("\n");
      const result = parseTestOutput(output, 1);
      assertEquals(result.failures.length, 1);
      assertEquals(result.failures[0].test, "my test");
    });

    it("success is determined by exit code not output text", () => {
      // Exit code 0 means success even if output says FAILED
      const result = parseTestOutput("FAILED | 0 passed | 1 failed (0.1s)", 0);
      assertEquals(result.success, true);

      // Exit code 1 means failure even if output says ok
      const result2 = parseTestOutput("ok | 1 passed | 0 failed (0.1s)", 1);
      assertEquals(result2.success, false);
    });

    it("handles fractional seconds in duration", () => {
      const result = parseTestOutput("ok | 1 passed | 0 failed (0.025s)", 0);
      assertEquals(result.summary.duration_ms, 25);
    });
  });
});
