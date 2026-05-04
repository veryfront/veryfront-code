import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildChildRunExecutionSnapshot,
  buildChildRunFailureResult,
  buildChildRunFailureSnapshot,
  buildChildRunResultCommon,
  buildChildRunSuccessResult,
  buildChildRunSuccessSnapshot,
  getChildRunSnapshotUsage,
} from "./child-run-execution-snapshot.ts";

const COMMON = {
  description: "Test task",
  steps: 3,
  toolCalls: [{ toolName: "bash", toolCallId: "tc-1" }],
  toolResults: [{ toolName: "bash", toolCallId: "tc-1", input: {}, output: "ok" }],
  usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  durationMs: 5000,
};

describe("agent/child-run-execution-snapshot", () => {
  it("builds success results with common execution metadata", () => {
    const result = buildChildRunSuccessResult(COMMON, { text: "Done!" });

    assertEquals(result, {
      success: true,
      description: "Test task",
      summary: { text: "Done!" },
      steps: 3,
      toolCalls: [{ toolName: "bash", toolCallId: "tc-1" }],
      toolResults: [{ toolName: "bash", toolCallId: "tc-1", input: {}, output: "ok" }],
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      durationMs: 5000,
    });
  });

  it("builds failure results with common execution metadata", () => {
    const result = buildChildRunFailureResult(COMMON, "Something broke");

    assertEquals(result, {
      success: false,
      description: "Test task",
      error: "Something broke",
      steps: 3,
      toolCalls: [{ toolName: "bash", toolCallId: "tc-1" }],
      toolResults: [{ toolName: "bash", toolCallId: "tc-1", input: {}, output: "ok" }],
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      durationMs: 5000,
    });
  });

  it("converts success and failure results to snapshots", () => {
    const success = buildChildRunExecutionSnapshot(
      buildChildRunSuccessResult(COMMON, { text: "full text" }),
    );
    const failure = buildChildRunExecutionSnapshot(buildChildRunFailureResult(COMMON, "error"));

    assertEquals(success.fullResultText, "full text");
    assertEquals(success.error, null);
    assertEquals(failure.fullResultText, null);
    assertEquals(failure.error, "error");
  });

  it("builds explicit success and failure snapshots", () => {
    assertEquals(buildChildRunFailureSnapshot(COMMON, "error", "partial text"), {
      success: false,
      description: "Test task",
      fullResultText: "partial text",
      error: "error",
      steps: 3,
      toolCalls: [{ toolName: "bash", toolCallId: "tc-1" }],
      toolResults: [{ toolName: "bash", toolCallId: "tc-1", input: {}, output: "ok" }],
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      durationMs: 5000,
    });

    assertEquals(buildChildRunSuccessSnapshot(COMMON, "full text"), {
      success: true,
      description: "Test task",
      fullResultText: "full text",
      error: null,
      steps: 3,
      toolCalls: [{ toolName: "bash", toolCallId: "tc-1" }],
      toolResults: [{ toolName: "bash", toolCallId: "tc-1", input: {}, output: "ok" }],
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      durationMs: 5000,
    });
  });

  it("returns common input unchanged and reads optional snapshot usage", () => {
    const common = buildChildRunResultCommon(COMMON);
    assertEquals(common, COMMON);
    assertEquals(
      getChildRunSnapshotUsage(buildChildRunSuccessSnapshot(COMMON, "full text")),
      COMMON.usage,
    );
    assertEquals(getChildRunSnapshotUsage(null), undefined);
  });
});
