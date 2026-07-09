import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  executeHostedChildForkStream,
  handleHostedChildForkFailure,
  type HostedChildForkPendingToolLifecycle,
} from "./child-fork-stream-execution.ts";
import type { ChildRunExecutionSnapshot } from "../child-run/execution-snapshot.ts";
import type { ForkPart, ForkRuntimeStep } from "../streaming/fork-runtime-stream.ts";

function createPendingToolLifecycle(chunks: unknown[]): HostedChildForkPendingToolLifecycle {
  const pendingToolCallIds = new Set<string>();
  return {
    emitToolInputStartIfNeeded: (toolCallId, toolName) => {
      chunks.push({ type: "tool-input-start", toolCallId, toolName });
    },
    upsertPendingToolCall: (toolCallId) => {
      pendingToolCallIds.add(toolCallId);
    },
    deletePendingToolCall: (toolCallId) => {
      pendingToolCallIds.delete(toolCallId);
    },
    closePendingToolCalls: () => {
      for (const toolCallId of pendingToolCallIds) {
        chunks.push({ type: "closed", toolCallId });
      }
      pendingToolCallIds.clear();
    },
  };
}

async function* partsStream(parts: ForkPart[]): AsyncGenerator<ForkPart, void, void> {
  for (const part of parts) {
    yield part;
  }
}

function createStep(input: { text: string; finishReason?: string | null }): ForkRuntimeStep {
  return {
    text: input.text,
    finishReason: input.finishReason ?? "stop",
    messages: [],
    toolCalls: [],
    toolResults: [],
  };
}

describe("hosted child fork stream execution", () => {
  it("streams text and tool lifecycle chunks through injected host hooks", async () => {
    const chunks: unknown[] = [];
    const writeLogs: unknown[] = [];
    const streamState = { finalText: "" };
    const toolCalls: Array<{ toolName: string; toolCallId: string; input?: unknown }> = [];
    const toolResults: Array<
      { toolName: string; toolCallId: string; input: unknown; output: unknown }
    > = [];

    const result = await executeHostedChildForkStream({
      streamResult: {
        fullStream: partsStream([
          { type: "text-delta", text: "Working" },
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "read_file",
            input: { path: "README.md" },
          },
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "read_file",
            input: { path: "README.md" },
            output: { structuredContent: { ok: true } },
          },
          { type: "text-delta", text: "Done" },
        ]),
        steps: Promise.resolve([createStep({ text: "Working\n\nDone" })]),
        totalUsage: Promise.resolve({ inputTokens: 3, outputTokens: 4 }),
      },
      abortForkStream: () => undefined,
      description: "Inspect repo",
      kind: "invoke_agent",
      durableRunMirror: true,
      durableMessageId: "msg-1",
      durableReasoningMessageId: "reasoning-1",
      durableMirrorState: { reasoningStarted: false, textStarted: false },
      appendDurableMirrorChunk: (chunk) => {
        chunks.push(chunk);
        return Promise.resolve();
      },
      closeDurableMirrorReasoning: () => Promise.resolve(),
      closeDurableMirrorText: () => Promise.resolve(),
      markDurableStepStarted: () => {
        chunks.push({ type: "marked-started" });
      },
      durableMirrorHasEmittedProgress: () => true,
      pendingToolLifecycle: createPendingToolLifecycle(chunks),
      toolCalls,
      toolResults,
      streamState,
      maxSteps: 10,
      startTime: Date.now(),
      finalizationTimeoutMs: 100,
      idleTimeoutMs: 1_000,
      activeToolTimeoutMs: 1_000,
      postToolIdleTimeoutMs: 1_000,
      writeLog: (entry) => {
        writeLogs.push(entry);
      },
    });

    assertEquals(result.success, true);
    assertEquals(streamState.finalText, "Working\n\nDone");
    assertEquals(toolCalls, [{
      toolName: "read_file",
      toolCallId: "tool-1",
      input: { path: "README.md" },
    }]);
    assertEquals(toolResults, [
      {
        toolName: "read_file",
        toolCallId: "tool-1",
        input: { path: "README.md" },
        output: { ok: true },
      },
    ]);
    assertExists(
      chunks.find((chunk) => typeof chunk === "object" && chunk !== null && "type" in chunk),
    );
    assertEquals(writeLogs.length, 1);
  });

  it("keeps the raw stream text in the settlement snapshot", async () => {
    const rawText =
      '  <function_calls><invoke name="run_bash">curl</invoke></function_calls><function_result>Title: Example</function_result>\n';
    const chunks: unknown[] = [];
    const streamState = { finalText: "" };
    const snapshots: ChildRunExecutionSnapshot[] = [];

    const result = await executeHostedChildForkStream({
      streamResult: {
        fullStream: partsStream([{ type: "text-delta", text: rawText }]),
        steps: Promise.resolve([createStep({ text: rawText })]),
        totalUsage: Promise.resolve({ inputTokens: 3, outputTokens: 4 }),
      },
      abortForkStream: () => undefined,
      description: "Inspect repo",
      kind: "invoke_agent",
      durableRunMirror: true,
      durableMessageId: "msg-1",
      durableReasoningMessageId: "reasoning-1",
      durableMirrorState: { reasoningStarted: false, textStarted: false },
      appendDurableMirrorChunk: (chunk) => {
        chunks.push(chunk);
        return Promise.resolve();
      },
      closeDurableMirrorReasoning: () => Promise.resolve(),
      closeDurableMirrorText: () => Promise.resolve(),
      markDurableStepStarted: () => {},
      durableMirrorHasEmittedProgress: () => true,
      pendingToolLifecycle: createPendingToolLifecycle(chunks),
      toolCalls: [],
      toolResults: [],
      streamState,
      maxSteps: 10,
      startTime: Date.now(),
      finalizationTimeoutMs: 100,
      idleTimeoutMs: 1_000,
      activeToolTimeoutMs: 1_000,
      postToolIdleTimeoutMs: 1_000,
      onSettled: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.summary.text, "Title: Example");
    }
    assertEquals(snapshots.length, 1);
    assertEquals(snapshots[0]?.fullResultText, rawText);
    assertStringIncludes(streamState.finalText, "<function_calls>");
  });

  it("builds failure result and snapshot for child fork errors", async () => {
    const writeLogs: unknown[] = [];
    const snapshots: unknown[] = [];

    const result = await handleHostedChildForkFailure({
      error: new Error("Model failed"),
      description: "Inspect repo",
      kind: "invoke_agent",
      finalText: "partial",
      toolCalls: [{ toolName: "read_file", toolCallId: "tool-1", input: { path: "README.md" } }],
      toolResults: [{ toolName: "read_file", toolCallId: "tool-1", input: {}, output: {} }],
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      startTime: Date.now(),
      onSettled: (snapshot) => {
        snapshots.push(snapshot);
      },
      writeLog: (entry) => {
        writeLogs.push(entry);
      },
    });

    assertEquals(result.success, false);
    if (!result.success) {
      assertEquals(result.error, "Model failed");
    }
    assertEquals(result.steps, 1);
    assertEquals(result.toolCalls.length, 1);
    assertEquals(result.toolResults.length, 1);
    assertEquals(snapshots.length, 1);
    assertEquals(writeLogs.length, 1);
  });

  it("rethrows child fork errors when host policy requires it", async () => {
    await assertRejects(
      () =>
        handleHostedChildForkFailure({
          error: new Error("Insufficient credits"),
          description: "Inspect repo",
          kind: "invoke_agent",
          finalText: "",
          toolCalls: [],
          toolResults: [],
          startTime: Date.now(),
          shouldRethrowError: () => true,
        }),
      Error,
      "Insufficient credits",
    );
  });
});
