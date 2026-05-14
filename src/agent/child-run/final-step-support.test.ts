import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendMissingChildRunToolCalls,
  appendMissingChildRunToolResults,
  buildChildRunExhaustedStepBudgetErrorMessage,
} from "./final-step-support.ts";

describe("agent/child-run-final-step-support", () => {
  it("appends tool calls that are not already present", () => {
    const existing = [{ toolCallId: "tc-1", toolName: "bash" }];
    appendMissingChildRunToolCalls(existing, [
      { toolCallId: "tc-1", toolName: "bash" },
      { toolCallId: "tc-2", toolName: "readFile" },
    ]);

    assertEquals(existing, [
      { toolCallId: "tc-1", toolName: "bash" },
      { toolCallId: "tc-2", toolName: "readFile" },
    ]);
  });

  it("appends tool results that are not already present", () => {
    const existing = [{ toolCallId: "tc-1", toolName: "bash", input: {}, output: "ok" }];
    appendMissingChildRunToolResults(existing, [
      { toolCallId: "tc-1", toolName: "bash", input: {}, output: "changed" },
      { toolCallId: "tc-2", toolName: "readFile", input: { path: "/a" }, output: "contents" },
    ]);

    assertEquals(existing, [
      { toolCallId: "tc-1", toolName: "bash", input: {}, output: "ok" },
      { toolCallId: "tc-2", toolName: "readFile", input: { path: "/a" }, output: "contents" },
    ]);
  });

  it("builds exhausted step budget messages with deduplicated tool names", () => {
    const message = buildChildRunExhaustedStepBudgetErrorMessage(50, [
      { toolName: "bash" },
      { toolName: "readFile" },
      { toolName: "bash" },
    ]);

    assertEquals(
      message,
      "Child agent exhausted its step budget (50 steps) without completing the task. Tools called: bash, readFile. Increase max_steps or simplify the task.",
    );
  });

  it("uses a none placeholder when no tools were called", () => {
    assertEquals(
      buildChildRunExhaustedStepBudgetErrorMessage(10, []),
      "Child agent exhausted its step budget (10 steps) without completing the task. Tools called: (none). Increase max_steps or simplify the task.",
    );
  });
});
