import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  executeHostedChildForkStream,
  type HostedChildForkPendingToolLifecycle,
} from "./hosted-child-fork-stream-execution.ts";
import type { ForkPart, ForkRuntimeStep } from "./fork-runtime-stream.ts";

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
});
