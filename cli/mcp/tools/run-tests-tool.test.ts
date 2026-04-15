/**
 * Tests for MCP run-tests tool
 */

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseTestOutput } from "../../commands/test/command.ts";
import { buildTestArgs, executeTests, TEST_ENV, vfRunTests } from "./run-tests-tool.ts";

// ---------------------------------------------------------------------------
// Tool definition (shape)
// ---------------------------------------------------------------------------

describe("mcp/tools/run-tests-tool", () => {
  describe("vfRunTests tool definition", () => {
    it("has correct tool name", () => {
      assertEquals(vfRunTests.name, "vf_run_tests");
    });

    it("has description mentioning tests", () => {
      assertExists(vfRunTests.description);
      assertEquals(vfRunTests.description.includes("test"), true);
    });

    it("has description cross-referencing vf_run_lint", () => {
      assertEquals(vfRunTests.description.includes("vf_run_lint"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfRunTests.execute, "function");
    });

    it("has correct annotations — not read-only, not destructive", () => {
      assertEquals(vfRunTests.annotations?.readOnlyHint, false);
      assertEquals(vfRunTests.annotations?.destructiveHint, false);
      assertEquals(vfRunTests.annotations?.idempotentHint, true);
      assertEquals(vfRunTests.annotations?.openWorldHint, false);
    });

    it("has title", () => {
      assertEquals(vfRunTests.title, "Run Tests");
    });
  });

  // ---------------------------------------------------------------------------
  // buildTestArgs
  // ---------------------------------------------------------------------------

  describe("buildTestArgs", () => {
    it("returns base args with no options", () => {
      const args = buildTestArgs({});
      assertEquals(args, [
        "test",
        "--no-check",
        "--allow-all",
        "--unstable-worker-options",
        "--unstable-net",
      ]);
    });

    it("adds --parallel when parallel is true", () => {
      const args = buildTestArgs({ parallel: true });
      assertEquals(args.includes("--parallel"), true);
    });

    it("does not add --parallel when parallel is false", () => {
      const args = buildTestArgs({ parallel: false });
      assertEquals(args.includes("--parallel"), false);
    });

    it("adds --filter with value when filter is provided", () => {
      const args = buildTestArgs({ filter: "router" });
      assertEquals(args.includes("--filter=router"), true);
    });

    it("does not add --filter when filter is undefined", () => {
      const args = buildTestArgs({});
      assertEquals(args.some((a) => a.startsWith("--filter")), false);
    });

    it("combines both parallel and filter", () => {
      const args = buildTestArgs({ filter: "auth", parallel: true });
      assertEquals(args.includes("--parallel"), true);
      assertEquals(args.includes("--filter=auth"), true);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST_ENV
  // ---------------------------------------------------------------------------

  describe("TEST_ENV", () => {
    it("sets VF_DISABLE_LRU_INTERVAL to 1", () => {
      assertEquals(TEST_ENV.VF_DISABLE_LRU_INTERVAL, "1");
    });

    it("sets NODE_ENV to production", () => {
      assertEquals(TEST_ENV.NODE_ENV, "production");
    });

    it("sets LOG_FORMAT to text", () => {
      assertEquals(TEST_ENV.LOG_FORMAT, "text");
    });

    it("sets SSR_TRANSFORM_PER_PROJECT_LIMIT to 0", () => {
      assertEquals(TEST_ENV.SSR_TRANSFORM_PER_PROJECT_LIMIT, "0");
    });

    it("sets REVALIDATION_PER_PROJECT_LIMIT to 0", () => {
      assertEquals(TEST_ENV.REVALIDATION_PER_PROJECT_LIMIT, "0");
    });
  });

  // ---------------------------------------------------------------------------
  // parseTestOutput (validates the parser the tool depends on)
  // ---------------------------------------------------------------------------

  describe("parseTestOutput integration", () => {
    it("parses a passing test run", () => {
      const output = [
        "running 3 tests from ./src/foo.test.ts",
        "test foo ... ok (2ms)",
        "test bar ... ok (1ms)",
        "test baz ... ok (0ms)",
        "",
        "ok | 3 passed | 0 failed (1.2s)",
      ].join("\n");

      const result = parseTestOutput(output, 0);
      assertEquals(result.success, true);
      assertEquals(result.summary.passed, 3);
      assertEquals(result.summary.failed, 0);
      assertEquals(result.summary.total, 3);
      assertEquals(result.summary.duration_ms, 1200);
      assertEquals(result.failures.length, 0);
    });

    it("parses a failing test run with failure details", () => {
      const output = [
        "running 2 tests from ./src/auth.test.ts",
        "test login ... ok (5ms)",
        "test logout ... FAILED",
        "  Error: expected true, got false",
        "    at file:///src/auth.test.ts:42",
        "",
        "ok | 1 passed | 1 failed (0.5s)",
      ].join("\n");

      const result = parseTestOutput(output, 1);
      assertEquals(result.success, false);
      assertEquals(result.summary.passed, 1);
      assertEquals(result.summary.failed, 1);
      assertEquals(result.summary.total, 2);
      assertEquals(result.failures.length, 1);
      assertEquals(result.failures[0].test, "test logout");
      assertEquals(result.failures[0].file, "file:///src/auth.test.ts");
      assertEquals(result.failures[0].line, 42);
    });

    it("parses output with skipped/ignored tests", () => {
      const output = [
        "running 5 tests from ./src/utils.test.ts",
        "test a ... ok (1ms)",
        "test b ... ok (1ms)",
        "test c ... ok (1ms)",
        "",
        "ok | 3 passed | 0 failed | 2 ignored (0.3s)",
      ].join("\n");

      const result = parseTestOutput(output, 0);
      assertEquals(result.success, true);
      assertEquals(result.summary.passed, 3);
      assertEquals(result.summary.skipped, 2);
      assertEquals(result.summary.total, 5);
    });

    it("handles empty output gracefully", () => {
      const result = parseTestOutput("", 0);
      assertEquals(result.success, true);
      assertEquals(result.summary.total, 0);
      assertEquals(result.failures.length, 0);
    });

    it("returns success false for non-zero exit code even without failures in output", () => {
      const result = parseTestOutput("some unexpected output", 1);
      assertEquals(result.success, false);
    });
  });

  // ---------------------------------------------------------------------------
  // executeTests timeout
  // ---------------------------------------------------------------------------

  describe("executeTests", () => {
    it("rejects on timeout", async () => {
      // Use an absurdly short timeout to trigger the timeout path.
      // Spawn a trivial command that will definitely be killed.
      await assertRejects(
        () => executeTests({ timeout: 1 }),
        Error,
        "timed out",
      );
    });
  });
});
