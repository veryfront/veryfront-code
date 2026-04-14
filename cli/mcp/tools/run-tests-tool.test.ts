/**
 * Tests for MCP run-tests tool
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { vfRunTests } from "./run-tests-tool.ts";

describe("mcp/tools/run-tests-tool", () => {
  it("has correct tool name", () => {
    assertEquals(vfRunTests.name, "vf_run_tests");
  });

  it("has description mentioning tests", () => {
    assertExists(vfRunTests.description);
    assertEquals(vfRunTests.description.includes("test"), true);
  });

  it("has execute function", () => {
    assertEquals(typeof vfRunTests.execute, "function");
  });

  it("has correct annotations — read-only, not destructive", () => {
    assertEquals(vfRunTests.annotations?.readOnlyHint, true);
    assertEquals(vfRunTests.annotations?.destructiveHint, false);
    assertEquals(vfRunTests.annotations?.idempotentHint, true);
    assertEquals(vfRunTests.annotations?.openWorldHint, false);
  });

  it("has title", () => {
    assertEquals(vfRunTests.title, "Run Tests");
  });
});
