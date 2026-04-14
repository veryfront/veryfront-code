/**
 * Tests for MCP run-lint tool
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { vfRunLint } from "./run-lint-tool.ts";

describe("mcp/tools/run-lint-tool", () => {
  describe("vfRunLint", () => {
    it("has correct tool name", () => {
      assertEquals(vfRunLint.name, "vf_run_lint");
    });

    it("has description mentioning lint", () => {
      assertExists(vfRunLint.description);
      assertEquals(vfRunLint.description.toLowerCase().includes("lint"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfRunLint.execute, "function");
    });

    it("has correct annotations", () => {
      assertExists(vfRunLint.annotations);
      assertEquals(vfRunLint.annotations!.readOnlyHint, true);
      assertEquals(vfRunLint.annotations!.destructiveHint, false);
      assertEquals(vfRunLint.annotations!.idempotentHint, true);
      assertEquals(vfRunLint.annotations!.openWorldHint, false);
    });

    it("has title", () => {
      assertEquals(vfRunLint.title, "Run Lint");
    });
  });
});
